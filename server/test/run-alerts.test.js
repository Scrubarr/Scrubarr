import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRunHealthNotification,
  scanFailureIssue,
  scheduledRunIssues,
  sendRunHealthNotification,
} from "../src/services/run-alerts.js";
import { createAppServices } from "../src/app/services.js";
import { createDefaultSettings } from "../src/config/settings.js";
import { ExternalServiceError } from "../src/services/external-error.js";

test("run alerts identify service and incomplete stages without leaking error details", () => {
  const issue = scanFailureIssue(new ExternalServiceError({
    service: "Emby", status: 503, detail: "https://private-host/?token=do-not-send",
  }));
  const message = formatRunHealthNotification({ issues: [issue] });
  assert.match(message, /Emby connection or request failed/);
  assert.match(message, /^<b>🧽 Scrubarr - /);
  assert.match(message, /🧼 Scrubarr-dub-dub 🧼$/);
  assert.doesNotMatch(message, /private-host|token|do-not-send/);
  assert.equal(scanFailureIssue(new Error("password=do-not-send")).key, "scan");
  assert.match(formatRunHealthNotification({ issues: [] }), /recovered/);
  const issues = scheduledRunIssues({
    result: { connectionFailures: ["Sonarr", "Radarr", "private-host"] },
    tagging: { failed: 1 }, librarySync: { status: "partial" },
    notifications: { status: "failed" },
    cleanup: { status: "failed", failedTotal: 1, librarySync: { status: "partial" } },
  });
  assert.deepEqual(issues.map((item) => item.key), [
    "connection:Sonarr", "connection:Radarr", "tagging", "libraries",
    "notifications", "cleanup", "queue-cleanup",
  ]);
  assert.deepEqual(scheduledRunIssues({ result: { warnings: ["Radarr intentionally disabled"] } }), []);
  assert.deepEqual(scheduledRunIssues({
    cleanup: {
      status: "success",
      deferredTotal: 1,
      deferralTelegram: { enabled: true, sent: true },
    },
  }), []);
  assert.deepEqual(scheduledRunIssues({
    cleanup: {
      status: "success",
      deferredTotal: 1,
      deferralTelegram: {
        enabled: true,
        sent: false,
        message: "Telegram deletion deferral report failed.",
      },
    },
  }).map((item) => item.key), ["deferral-report"]);
});

test("run alerts surface final safety warnings, tag cleanup, and attempted report failures", () => {
  const issues = scheduledRunIssues({
    cleanup: {
      status: "success",
      revalidationWarnings: ["One media source was unavailable"],
      untagging: { enabled: true, failed: 1 },
      removalTelegram: {
        enabled: true,
        attempted: true,
        sent: false,
        message: "Forbidden",
      },
    },
  });

  assert.deepEqual(issues.map((item) => item.key), [
    "pending-tag-removal",
    "deletion-revalidation",
    "pending-removal-report",
  ]);
});

test("run alerts respect enabled flag but not reminder policy", async () => {
  let calls = 0;
  const send = async () => { calls += 1; return { messageCount: 1 }; };
  const event = { issues: [scanFailureIssue(new Error("failed"))] };
  assert.equal((await sendRunHealthNotification({ Telegram: { Enabled: false } }, event, send)).sent, false);
  for (const policy of ["standard", "lifecycle", "full"]) {
    const result = await sendRunHealthNotification({ Telegram: { Enabled: true, NotificationPolicy: policy } }, event, send);
    assert.equal(result.sent, true);
  }
  assert.equal(calls, 3);
});

test("successful sync status cannot hide unwritable paths or scan warnings", () => {
  for (const details of [
    { links: [{ writable: false, pending: 1 }] },
    { links: [{ writable: true, skipped: ["missing source"] }] },
    { scanWarnings: ["library count not checked"] },
    { queueCleanupWarnings: ["queue cleanup failed"] },
  ]) {
    assert.deepEqual(scheduledRunIssues({ librarySync: { status: "success", ...details } }).map((item) => item.key), ["libraries"]);
  }
  assert.deepEqual(scheduledRunIssues({ librarySync: { status: "success", links: [{ writable: false, pending: 0 }] } }), []);
});

test("Scrubarr application wiring sends its own failure and recovery messages", async (t) => {
  const messages = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(String(url), /^https:\/\/api.telegram.org\/bot123:fake\/sendMessage$/);
    messages.push(JSON.parse(options.body));
    return Response.json({ ok: true });
  });
  const memory = (value = {}) => ({
    read: async () => structuredClone(value),
    write: async (next) => { value = structuredClone(next); },
  });
  const defaults = createDefaultSettings({});
  const stores = {
    settingsStore: memory({ Telegram: { Enabled: true, BotToken: "123:fake", ChatID: "test-chat" } }),
    schedulerStore: memory(), updateCheckStore: memory(),
  };
  const { scheduler } = createAppServices({
    runtime: { timezone: "UTC" }, stores, defaults,
    appLog: { info: async () => { throw new Error("disk full"); }, warn: async () => {} },
    workflows: { tagPendingItems: async () => null, syncCurrentDeletionLibraries: async () => null },
  });
  t.after(() => scheduler.stop());
  scheduler.scanCoordinator.commitEligibleCandidates = async () => { throw new ExternalServiceError({ service: "Jellyfin", status: 503 }); };
  await scheduler.start();
  await assert.rejects(scheduler.runNow(), /Jellyfin/);
  await assert.rejects(scheduler.runNow(), /Jellyfin/);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].chat_id, "test-chat");
  assert.equal(messages[0].parse_mode, "HTML");
  assert.match(messages[0].text, /Jellyfin connection/);
  scheduler.scanCoordinator.commitEligibleCandidates = async () => ({ added: [], result: { candidates: [], summary: {} } });
  await scheduler.runNow();
  assert.equal(messages.length, 2);
  assert.match(messages[1].text, /recovered/);
});
