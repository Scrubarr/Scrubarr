import assert from "node:assert/strict";
import test from "node:test";
import { SchedulerService } from "../src/services/scheduler.js";
import { PendingMutationBusyError } from "../src/services/pending-mutation-coordinator.js";

function fixture(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-06T11:59:00Z") });
  const timers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const timer = { callback, delay, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => { timer.cleared = true; });
  t.mock.method(console, "error", () => {});
  const state = { config: { enabled: true, frequency: "daily", time: "12:00", daysOfWeek: [0] } };
  const store = { read: async () => structuredClone(state), write: async (value) => Object.assign(state, structuredClone(value)) };
  const messages = [];
  const counts = { scans: 0, cleanup: 0 };
  const success = async () => {
    counts.scans += 1;
    return { added: [], result: { candidates: [], summary: {}, warnings: [] } };
  };
  const options = {
    store, timezone: "UTC", scanCoordinator: { isBusy: () => false, commitEligibleCandidates: success },
    cleanup: async () => { counts.cleanup += 1; return { status: "success" }; },
    runHealthNotification: async (event) => { messages.push(event); return { sent: true }; },
    ...overrides,
  };
  const scheduler = new SchedulerService(options);
  t.after(() => scheduler.stop());
  const fire = async (time) => {
    t.mock.timers.setTime(new Date(time).getTime());
    await timers.at(-1).callback();
  };
  return { scheduler, timers, messages, counts, state, success, options, fire };
}

test("busy scheduled scan retries once armed at a time, then succeeds without duplicate cleanup", async (t) => {
  const f = fixture(t);
  f.scheduler.pendingMutations = { run: async () => { throw new PendingMutationBusyError("scan", "manual"); } };
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-06T12:01:00.000Z");
  assert.equal(f.timers.filter((timer) => !timer.cleared).length, 1);
  assert.equal(f.messages.length, 1);
  f.scheduler.pendingMutations = { run: async (_op, callback) => callback() };
  await f.fire("2026-09-06T12:01:00Z");
  assert.equal(f.counts.scans, 1);
  assert.equal(f.counts.cleanup, 1);
  assert.equal(f.messages.length, 2);
  assert.deepEqual(f.messages[1].issues, []);
  assert.equal(f.state.lastScheduledDate, "2026-09-06");
  assert.equal(f.scheduler.status().nextRun, "2026-09-07T12:00:00.000Z");
  await f.scheduler.runNow({ scheduledDate: "2026-09-06" });
  assert.equal(f.counts.cleanup, 1);
});

test("two failed retries stop until next normal schedule and do not spam Telegram", async (t) => {
  const f = fixture(t, { pendingMutations: { run: async () => { throw new PendingMutationBusyError("scan", "manual"); } } });
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  await f.fire("2026-09-06T12:01:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-06T12:06:00.000Z");
  await f.fire("2026-09-06T12:06:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-07T12:00:00.000Z");
  assert.equal(f.messages.length, 1);
  assert.equal(f.counts.cleanup, 0);
});

test("schedule changes invalidate old retry callbacks", async (t) => {
  const f = fixture(t, { pendingMutations: { run: async () => { throw new PendingMutationBusyError("scan", "manual"); } } });
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  const stale = f.timers.at(-1);
  await f.scheduler.update({ ...f.state.config, enabled: false });
  await stale.callback();
  assert.equal(f.scheduler.status().nextRun, null);
  assert.equal(f.counts.scans, 0);
  assert.equal(f.messages.length, 1);
});

test("failed or partial post-commit stages notify but never retry the run", async (t) => {
  const f = fixture(t, { librarySync: async () => { throw new Error("Emby unavailable"); } });
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-07T12:00:00.000Z");
  assert.equal(f.state.lastRun.status, "partial");
  assert.equal(f.messages[0].issues[0].key, "libraries");
  assert.equal(f.counts.cleanup, 1);
});

test("unclassified failures never qualify for retry", async (t) => {
  const f = fixture(t);
  f.scheduler.scanCoordinator.commitEligibleCandidates = async () => { throw new Error("disk write failed"); };
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-07T12:00:00.000Z");
  assert.equal(f.messages.length, 1);
  assert.equal(f.counts.cleanup, 0);
});

test("alert delivery failure does not break scheduling and is retried on the next health check", async (t) => {
  let deliveryAttempts = 0;
  const f = fixture(t, { runHealthNotification: async () => { deliveryAttempts += 1; throw new Error("Telegram unavailable"); } });
  f.scheduler.pendingMutations = { run: async () => { throw new PendingMutationBusyError("scan", "manual"); } };
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  assert.equal(f.state.runAlert, null);
  await f.fire("2026-09-06T12:01:00Z");
  assert.equal(deliveryAttempts, 2);
  assert.equal(f.scheduler.status().nextRun, "2026-09-06T12:06:00.000Z");
});

test("alert deduplication survives restart and allows a daily reminder", async (t) => {
  const f = fixture(t);
  const issue = { key: "scan", label: "Scan failed" };
  await f.scheduler.start();
  await f.scheduler.reportRunHealth([issue]);
  f.scheduler.stop();
  const restarted = new SchedulerService(f.options);
  t.after(() => restarted.stop());
  await restarted.start();
  await restarted.reportRunHealth([issue]);
  assert.equal(f.messages.length, 1);
  t.mock.timers.setTime(new Date("2026-09-07T12:00:00Z").getTime());
  await restarted.reportRunHealth([issue]);
  assert.equal(f.messages.length, 2);
  await restarted.reportRunHealth([]);
  await restarted.reportRunHealth([]);
  assert.equal(f.messages.length, 3);
});

test("overlapping health reports share the delivery decision", async (t) => {
  let release;
  let count = 0;
  const blocked = new Promise((resolve) => { release = resolve; });
  const f = fixture(t, { runHealthNotification: async () => { count += 1; await blocked; return { sent: true }; } });
  await f.scheduler.start();
  const issue = { key: "scan", label: "Scan failed" };
  const first = f.scheduler.reportRunHealth([issue]);
  const second = f.scheduler.reportRunHealth([issue]);
  release();
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test("retry callbacks cannot carry a previous date's work into the next day", async (t) => {
  const f = fixture(t, { pendingMutations: { run: async () => { throw new PendingMutationBusyError("scan", "manual"); } } });
  await f.scheduler.start();
  await f.fire("2026-09-06T12:00:00Z");
  await f.fire("2026-09-07T00:00:00Z");
  assert.equal(f.scheduler.status().nextRun, "2026-09-07T12:00:00.000Z");
  assert.equal(f.messages.length, 1);
  assert.equal(f.counts.cleanup, 0);
});
