import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDate,
  collectRunProblems,
  filterRunEntries,
  findScheduledRunEntry,
  getRunOutcome,
  isActualDeletionRecord,
  isDeletionRelatedLog,
  paginateRunEntries,
  runSummary,
  scheduledRunLink,
} from "../src/lib/runPresentation.js";

test("classifies clean, warning, partial, failed, and unknown runs", () => {
  assert.equal(getRunOutcome({ status: "success" }).key, "completed");
  assert.equal(getRunOutcome({ status: "success", warnings: ["Library scan delayed"] }).key, "warning");
  assert.equal(getRunOutcome({ status: "partial" }).key, "partial");
  assert.equal(getRunOutcome({ status: "success", cleanup: { failed: 1 } }).key, "partial");
  assert.equal(getRunOutcome({ status: "success", deferredTotal: 1 }).key, "protected");
  assert.equal(getRunOutcome({
    status: "success",
    deferredTotal: 1,
    revalidationWarnings: ["One source could not be checked"],
  }).key, "warning");
  assert.equal(getRunOutcome({ status: "failed", warnings: ["Also warned"] }).key, "failed");
  assert.equal(getRunOutcome({}).key, "unknown");
});

test("collects legacy and retained issues without double-counting identical text", () => {
  const problems = collectRunProblems({
    issues: [
      { key: "media-server", label: "Media server connection failed." },
      { key: "same-label", label: "Repeated warning" },
    ],
    warnings: ["Repeated warning", "Legacy warning"],
    librarySync: {
      scanWarnings: ["Legacy warning", "Scan remains active"],
      queueCleanupWarnings: [
        { type: "Movie", title: "Example", reason: "Link is stale" },
      ],
    },
    revalidationWarnings: ["Revalidation delayed"],
  });

  assert.deepEqual(problems, [
    "Media server connection failed.",
    "Repeated warning",
    "Legacy warning",
    "Scan remains active",
    "Movie: Example: Link is stale",
    "Revalidation delayed",
  ]);
});

test("does not infer a problem from skipped or unsent optional stages", () => {
  assert.equal(getRunOutcome({
    status: "success",
    notifications: { status: "skipped", enabled: false, sent: false },
    cleanup: { status: "skipped" },
    candidates: 0,
  }).key, "completed");
  assert.equal(getRunOutcome({
    status: "success",
    type: "deletion",
    telegram: { enabled: true, sent: false, message: "No report was due." },
  }).key, "completed");
});

test("surfaces explicit Telegram report delivery errors in legacy deletion records", () => {
  const entry = {
    status: "success",
    type: "deletion",
    telegram: { enabled: true, sent: false, message: "Telegram API failed with HTTP 500" },
  };
  assert.equal(getRunOutcome(entry).key, "warning");
  assert.deepEqual(collectRunProblems(entry), ["Telegram deletion report was not delivered."]);
});

test("surfaces attempted queue update report failures regardless of provider wording", () => {
  const entry = {
    status: "success",
    type: "deletion",
    removalTelegram: {
      enabled: true,
      attempted: true,
      sent: false,
      message: "Forbidden",
    },
  };
  assert.equal(getRunOutcome(entry).key, "warning");
  assert.deepEqual(collectRunProblems(entry), [
    "Telegram pending queue update report was not delivered.",
  ]);
});

test("distinguishes preview deletion checks from actual deletion records", () => {
  const preview = { type: "deletion", dryRun: true, expiredTotal: 1 };
  const live = { type: "deletion", dryRun: false, deletedTotal: 1 };
  const removed = { type: "deletion", dryRun: false, removedTotal: 1 };
  assert.equal(isDeletionRelatedLog(preview), true);
  assert.equal(isActualDeletionRecord(preview), false);
  assert.equal(isActualDeletionRecord(live), true);
  assert.equal(isActualDeletionRecord(removed), true);
});

test("summarizes pending removals separately from deletions and deferrals", () => {
  assert.equal(
    runSummary({
      type: "deletion",
      dryRun: false,
      expiredTotal: 2,
      deletedTotal: 0,
      removedTotal: 1,
      deferredTotal: 1,
      failedTotal: 0,
    }),
    "2 due, 0 deleted, 1 removed from pending, 1 deferred, 0 failed",
  );
});

test("filters inclusive calendar dates in the configured timezone", () => {
  const entries = [
    { id: "utc-june", status: "success", completedAt: "2026-06-30T23:30:00.000Z" },
    { id: "utc-july", status: "success", completedAt: "2026-07-01T23:30:00.000Z" },
  ];
  assert.equal(calendarDate(entries[0].completedAt, "Pacific/Auckland"), "2026-07-01");
  assert.deepEqual(
    filterRunEntries(entries, { from: "2026-07-01", to: "2026-07-01", timeZone: "Pacific/Auckland" }).map((entry) => entry.id),
    ["utc-june"],
  );
});

test("filters warning runs separately from failed and partial runs", () => {
  const entries = [
    { id: "clean", status: "success" },
    { id: "warning", status: "success", warnings: ["Review this"] },
    { id: "partial", status: "partial" },
    { id: "failed", status: "failed" },
  ];
  assert.deepEqual(filterRunEntries(entries, { result: "warnings" }).map((entry) => entry.id), ["warning"]);
  assert.deepEqual(filterRunEntries(entries, { result: "problems" }).map((entry) => entry.id), ["partial", "failed"]);
});

test("paginates and clamps invalid or out-of-range pages", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1) }));
  assert.deepEqual(paginateRunEntries(entries, "5", 2).entries.map((entry) => entry.id), ["6", "7", "8", "9", "10"]);
  assert.equal(paginateRunEntries(entries, "5", 99).page, 3);
  assert.equal(paginateRunEntries(entries, "all", 4).entries.length, 12);
  assert.equal(paginateRunEntries([], "all", 4).page, 1);
});

test("uses singular candidate wording in compact scan summaries", () => {
  assert.equal(
    runSummary({ scanned: 42, candidates: 1, queued: 1 }),
    "42 scanned, 1 candidate, 1 queued",
  );
});

test("correlates exact scheduled runs and creates a stable fallback link", () => {
  const lastRun = { completedAt: "2026-09-08T10:00:00.000Z" };
  const entries = [
    { id: "manual", source: "manual", type: "preview", completedAt: lastRun.completedAt },
    { id: "exact-scheduled", source: "scheduler", type: "scan", completedAt: lastRun.completedAt },
  ];
  assert.equal(findScheduledRunEntry(lastRun, entries)?.id, "exact-scheduled");
  assert.equal(scheduledRunLink(lastRun, entries), "/logs?run=exact-scheduled");
  assert.equal(
    scheduledRunLink(lastRun),
    "/logs?run=2026-09-08T10%3A00%3A00.000Z-scheduler",
  );
});
