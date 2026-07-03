import assert from "node:assert/strict";
import test from "node:test";
import {
  nextScheduledRun,
  SchedulerService,
  validateScheduleConfig,
} from "../src/services/scheduler.js";

class MemoryStore {
  constructor(value = {}) {
    this.value = value;
  }

  async read() {
    return structuredClone(this.value);
  }

  async write(value) {
    this.value = structuredClone(value);
  }
}

test("validates scheduler configuration", () => {
  assert.deepEqual(
    validateScheduleConfig({
      enabled: true,
      frequency: "daily",
      time: "03:00",
      daysOfWeek: [1],
    }),
    [],
  );
  assert.equal(
    validateScheduleConfig({
      enabled: true,
      frequency: "weekly",
      time: "25:00",
      daysOfWeek: [],
    }).length,
    2,
  );
});

test("calculates the next daily run in the configured timezone", () => {
  const next = nextScheduledRun(
    {
      enabled: true,
      frequency: "daily",
      time: "03:00",
      daysOfWeek: [0],
    },
    "Pacific/Auckland",
    new Date("2026-06-07T12:00:00.000Z"),
  );

  assert.equal(next.toISOString(), "2026-06-07T15:00:00.000Z");
});

test("calculates selected weekday runs", () => {
  const next = nextScheduledRun(
    {
      enabled: true,
      frequency: "weekly",
      time: "04:30",
      daysOfWeek: [1],
    },
    "UTC",
    new Date("2026-06-07T12:00:00.000Z"),
  );

  assert.equal(next.toISOString(), "2026-06-08T04:30:00.000Z");
});

test("persists schedule state and queues candidates during scheduled runs", async () => {
  const store = new MemoryStore();
  let syncCount = 0;
  let notificationCount = 0;
  let cleanupCount = 0;
  let mutationName = "";
  const scanCoordinator = {
    isBusy: () => false,
    commitEligibleCandidates: async () => ({
      added: [{ ItemId: "1", Type: "Movie" }],
      result: {
        readOnly: false,
        candidates: [{ ItemId: "1" }],
        queue: { added: 1, movies: 1, series: 0 },
        warnings: ["Example warning"],
        summary: {
          scanned: 3,
          candidateMovies: 1,
          candidateSeries: 0,
        },
      },
    }),
  };
  const pendingMutations = {
    run: async (operation, callback) => {
      mutationName = operation;
      return callback();
    },
  };
  const scheduler = new SchedulerService({
    store,
    scanCoordinator,
    timezone: "UTC",
    pendingMutations,
    librarySync: async () => {
      syncCount += 1;
      return {
        enabled: true,
        pending: 2,
        refreshed: true,
        message: "Deletion library sync completed.",
      };
    },
    notifications: async () => {
      notificationCount += 1;
      return {
        enabled: true,
        sent: true,
        due: 2,
        messageCount: 1,
        message: "Sent 2 pending Telegram notification item(s).",
      };
    },
    cleanup: async () => {
      cleanupCount += 1;
      return {
        status: "success",
        dryRun: true,
        expiredTotal: 1,
        deletedTotal: 0,
        failedTotal: 0,
        message: "Dry run complete: 1 item(s) would be deleted.",
      };
    },
  });

  await scheduler.start();
  const status = await scheduler.update({
    enabled: true,
    frequency: "daily",
    time: "03:00",
    daysOfWeek: [0],
  });
  const run = await scheduler.runNow();
  scheduler.stop();

  assert.equal(status.config.enabled, true);
  assert.equal(mutationName, "scheduled-queue-commit");
  assert.equal(run.readOnly, false);
  assert.equal(run.candidates, 1);
  assert.equal(run.queued, 1);
  assert.equal(run.queuedMovies, 1);
  assert.equal(run.queuedSeries, 0);
  assert.equal(run.scanned, 3);
  assert.equal(syncCount, 1);
  assert.equal(notificationCount, 1);
  assert.equal(cleanupCount, 1);
  assert.equal(run.librarySync.enabled, true);
  assert.equal(run.librarySync.refreshed, true);
  assert.equal(run.notifications.sent, true);
  assert.equal(run.notifications.due, 2);
  assert.equal(run.cleanup.dryRun, true);
  assert.equal(run.cleanup.expired, 1);
  assert.equal(store.value.config.enabled, true);
  assert.equal(store.value.lastRun.status, "success");
});

test("scheduler summaries remain read-only when using an old scan coordinator", async () => {
  const store = new MemoryStore();
  const scanCoordinator = {
    isBusy: () => false,
    commitEligibleCandidates: async () => ({
      added: [],
      result: {
        readOnly: true,
        candidates: [],
        queue: { added: 0, movies: 0, series: 0 },
        warnings: [],
        summary: {
          scanned: 1,
          candidateMovies: 0,
          candidateSeries: 0,
        },
      },
    }),
  };
  const scheduler = new SchedulerService({
    store,
    scanCoordinator,
    timezone: "UTC",
  });

  await scheduler.start();
  const run = await scheduler.runNow();
  scheduler.stop();

  assert.equal(run.readOnly, true);
  assert.equal(run.queued, 0);
});

test("scheduled runs remain successful when library sync fails", async () => {
  const store = new MemoryStore();
  const scanCoordinator = {
    isBusy: () => false,
    commitEligibleCandidates: async () => ({
      added: [],
      result: {
        readOnly: false,
        candidates: [],
        queue: { added: 0, movies: 0, series: 0 },
        warnings: [],
        summary: {
          scanned: 1,
          candidateMovies: 0,
          candidateSeries: 0,
        },
      },
    }),
  };
  const scheduler = new SchedulerService({
    store,
    scanCoordinator,
    timezone: "UTC",
    librarySync: async () => {
      throw new Error("Emby refresh failed");
    },
  });

  await scheduler.start();
  const run = await scheduler.runNow();
  scheduler.stop();

  assert.equal(run.status, "success");
  assert.equal(run.librarySync.status, "failed");
  assert.equal(run.librarySync.message, "Emby refresh failed");
});

test("scheduled runs fail when the scan queue commit fails", async () => {
  const store = new MemoryStore();
  const scanCoordinator = {
    isBusy: () => false,
    commitEligibleCandidates: async () => {
      const error = new Error("A scan operation is already running");
      error.code = "scan_operation_in_progress";
      throw error;
    },
  };
  const scheduler = new SchedulerService({
    store,
    scanCoordinator,
    timezone: "UTC",
  });

  await scheduler.start();
  await assert.rejects(() => scheduler.runNow(), /already running/);
  scheduler.stop();

  assert.equal(store.value.lastRun.status, "failed");
});
