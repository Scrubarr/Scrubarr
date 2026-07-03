import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { pendingDeletionSummary } from "../src/services/pending-summary.js";

test("pending deletion summary reports the earliest eligible pending item", () => {
  const settings = createDefaultSettings();
  settings.CleanupRules.DryRun = false;
  settings.DeletionSchedule.DaysUntilDeletion = 5;

  const summary = pendingDeletionSummary({
    settings,
    timezone: "UTC",
    now: new Date("2026-06-25T12:00:00.000Z"),
    pending: [
      {
        ItemId: "future",
        Title: "Future Item",
        Type: "Movie",
        MarkedDate: "2026-06-23",
        Deleted: null,
      },
      {
        ItemId: "expired",
        Title: "Expired Item",
        Type: "Series",
        MarkedDate: "2026-06-20",
        Deleted: null,
      },
      {
        ItemId: "deleted",
        Title: "Deleted Item",
        Type: "Movie",
        MarkedDate: "2026-06-18",
        Deleted: "2026-06-25",
      },
    ],
  });

  assert.equal(summary.mode, "live");
  assert.equal(summary.pendingTotal, 2);
  assert.equal(summary.expiredTotal, 1);
  assert.deepEqual(summary.nextEligible, {
    date: "2026-06-25",
    daysRemaining: 0,
    daysOverdue: 0,
    count: 1,
    item: {
      ItemId: "expired",
      Title: "Expired Item",
      Type: "Series",
      Year: null,
    },
  });
  assert.equal(
    summary.items.find((item) => item.ItemId === "future").DaysRemaining,
    3,
  );
});

test("pending deletion summary marks preview mode as advisory", () => {
  const settings = createDefaultSettings();
  settings.CleanupRules.DryRun = true;

  const summary = pendingDeletionSummary({
    settings,
    timezone: "UTC",
    now: new Date("2026-06-25T12:00:00.000Z"),
    pending: [],
  });

  assert.equal(summary.mode, "preview");
  assert.equal(summary.pendingTotal, 0);
  assert.equal(summary.nextEligible, null);
});
