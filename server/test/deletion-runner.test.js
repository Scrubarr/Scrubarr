import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deletionRunLogEntry,
  expiredPendingItems,
  runDeletionCheck,
} from "../src/services/deletion-runner.js";

function settings({
  dryRun = true,
  telegram = false,
  fallback = false,
  allowedRoots = [],
} = {}) {
  return {
    CleanupRules: {
      DryRun: dryRun,
      FallbackFileDeletion: fallback,
      DirectFileDeletionAllowedRoots: allowedRoots,
    },
    DeletionSchedule: { DaysUntilDeletion: 20 },
    Telegram: {
      Enabled: telegram,
      BotToken: "123:token",
      ChatID: "-100123",
    },
  };
}

function unavailableArrError() {
  const error = new Error("Arr deletion service is not enabled or configured");
  error.code = "arr_delete_unavailable";
  return error;
}

function approvedRevalidation(items) {
  return { allowedItems: items, deferredItems: [] };
}

test("finds pending items that have reached the deletion date", () => {
  const due = expiredPendingItems({
    settings: settings(),
    timezone: "Pacific/Auckland",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-31" },
      { Title: "New Movie", Type: "Movie", MarkedDate: "2026-06-10" },
      { Title: "Deleted Movie", Type: "Movie", MarkedDate: "2026-05-01", Deleted: true },
      { Title: "Deleted Date Movie", Type: "Movie", MarkedDate: "2026-05-01", Deleted: "2026-06-20" },
    ],
  });

  assert.equal(due.length, 1);
  assert.equal(due[0].Title, "Old Movie");
  assert.equal(due[0].PendingAgeDays, 20);
  assert.equal(due[0].DaysOverdue, 0);
});

test("dry-run deletion check reports expired items without deleting", async () => {
  const sent = [];
  const result = await runDeletionCheck({
    settings: settings({ telegram: true }),
    timezone: "Pacific/Auckland",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-31" },
      { Title: "Old Series", Type: "Series", MarkedDate: "2026-05-01" },
    ],
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.expiredTotal, 2);
  assert.equal(result.expiredMovies, 1);
  assert.equal(result.expiredSeries, 1);
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.telegram.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Preview Only Deletion Report/);
});

test("live deletion marks successful expired items and reports totals", async () => {
  const sent = [];
  const pending = [
    { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-31" },
    { ItemId: "series-1", Title: "New Series", Type: "Series", MarkedDate: "2026-06-19" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "Pacific/Auckland",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation([pending[0]]),
    deleteItem: async (_settings, item) => ({
      method: item.Type === "Movie" ? "radarr" : "sonarr",
      message: "Deleted by fake Arr",
    }),
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.changed, true);
  assert.equal(result.deletedTotal, 1);
  assert.equal(result.failedTotal, 0);
  assert.equal(result.pending[0].Deleted, "2026-06-20");
  assert.equal(result.pending[0].DeletionMethod, "radarr");
  assert.equal(result.pending[1].Deleted, undefined);
  assert.equal(result.telegram.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Deletion Report/);
});

test("live deletion defers items when final revalidation is missing", async () => {
  let deleteCalled = false;
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
    ],
    deleteItem: async () => {
      deleteCalled = true;
      return { method: "radarr", message: "Should not run" };
    },
  });

  assert.equal(deleteCalled, false);
  assert.equal(result.status, "partial");
  assert.equal(result.deferredTotal, 1);
  assert.equal(result.deferredItems[0].SkipCode, "revalidation-required");
});

test("live deletion keeps failed items pending and sends failure report", async () => {
  const sent = [];
  const pending = [
    { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation(pending),
    deleteItem: async () => {
      throw new Error("Radarr refused deletion");
    },
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.changed, false);
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 1);
  assert.equal(result.pending[0].Deleted, undefined);
  assert.equal(result.failureTelegram.sent, true);
  assert.match(sent.join("\n"), /Deletion Failures/);
});

test("live deletion blocks items with active playback", async () => {
  let deleteCalled = false;
  const pending = [
    { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation(pending),
    activeStreamChecker: async () => ({
      title: "Old Movie",
      userName: "Test User",
      client: "Browser",
      deviceName: "Laptop",
    }),
    deleteItem: async () => {
      deleteCalled = true;
      return { method: "radarr", message: "Deleted by fake Arr" };
    },
  });

  assert.equal(deleteCalled, false);
  assert.equal(result.status, "success");
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 0);
  assert.equal(result.deferredTotal, 1);
  assert.match(result.deferredItems[0].SkipMessage, /Deletion deferred because media is in use/);
  assert.match(result.message, /completed safely/);
});

test("live deletion blocks paused playback sessions", async () => {
  let deleteCalled = false;
  const pending = [
    { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation(pending),
    activeStreamChecker: async () => ({
      title: "Old Movie",
      userName: "Test User",
      client: "Browser",
      deviceName: "Laptop",
      paused: true,
    }),
    deleteItem: async () => {
      deleteCalled = true;
      return { method: "radarr", message: "Deleted by fake Arr" };
    },
  });

  assert.equal(deleteCalled, false);
  assert.equal(result.status, "success");
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 0);
  assert.equal(result.deferredTotal, 1);
  assert.match(result.deferredItems[0].SkipMessage, /Deletion deferred because media is in use/);
});

test("live deletion sends a clear report for protected deferred items", async () => {
  const sent = [];
  const pending = [
    { ItemId: "series-1", Title: "Protected Series", Type: "Series", MarkedDate: "2026-05-01" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: {
      allowedItems: [],
      deferredItems: [{
        ...pending[0],
        SkipCode: "media-in-use",
        SkipMessage:
          "Deletion deferred for safety because the item is currently playing or paused.",
      }],
      warnings: [],
    },
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.deferredTotal, 1);
  assert.equal(result.changed, false);
  assert.equal(result.pendingChanged, true);
  assert.deepEqual(result.pending[0].DeferralNotification, {
    Code: "media-in-use",
    SentDate: "2026-06-20",
  });
  assert.equal(result.deferralTelegram.sent, true);
  assert.equal(result.failureTelegram.sent, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Deletion Deferred for Safety/);
  assert.match(sent[0], /Protected Series/);
  assert.match(sent[0], /Currently playing or paused/);
});

test("live deletion does not repeat an unchanged deferral notification", async () => {
  const sent = [];
  const pending = [
    {
      ItemId: "series-1",
      Title: "Protected Series",
      Type: "Series",
      MarkedDate: "2026-05-01",
      DeferralNotification: { Code: "media-in-use", SentDate: "2026-06-19" },
    },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: {
      allowedItems: [],
      deferredItems: [{
        ...pending[0],
        SkipCode: "media-in-use",
        SkipMessage:
          "Deletion deferred for safety because the item is currently playing or paused.",
      }],
      warnings: [],
    },
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.pendingChanged, false);
  assert.equal(result.deferralTelegram.sent, false);
  assert.equal(result.deferralTelegram.message, "No new deletion deferrals to report.");
  assert.equal(sent.length, 0);
});

test("live deletion removes due items that no longer meet cleanup rules", async () => {
  const sent = [];
  const pending = [
    {
      ItemId: "series-1",
      Title: "No Longer Eligible",
      Type: "Series",
      MarkedDate: "2026-05-01",
    },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: {
      allowedItems: [],
      deferredItems: [{
        ...pending[0],
        SkipCode: "age-rule-not-met",
        SkipMessage:
          "Removed from pending because the item's current watch history no longer meets the cleanup age rules.",
      }],
      warnings: [],
    },
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.removedTotal, 1);
  assert.equal(result.removedSeries, 1);
  assert.equal(result.deferredTotal, 0);
  assert.equal(result.pending.length, 0);
  assert.equal(result.changed, true);
  assert.equal(result.pendingChanged, true);
  assert.equal(result.removalTelegram.sent, true);
  assert.equal(result.deferralTelegram.sent, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Scrubarr · Kept in library/);
  assert.match(sent[0], /No Longer Eligible/);
  assert.match(sent[0], /removed these items from Pending Deletions/);
});

test("live deletion fails closed when active playback check fails", async () => {
  let deleteCalled = false;
  const pending = [
    { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation(pending),
    activeStreamChecker: async () => {
      throw new Error("Unable to load active playback sessions");
    },
    deleteItem: async () => {
      deleteCalled = true;
      return { method: "radarr", message: "Deleted by fake Arr" };
    },
  });

  assert.equal(deleteCalled, false);
  assert.equal(result.status, "failed");
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 1);
  assert.match(result.failedItems[0].DeleteError, /Unable to load active playback sessions/);
});

test("live deletion direct filesystem fallback requires approved roots", async () => {
  const pending = [
    {
      ItemId: "movie-1",
      Title: "Old Movie",
      Type: "Movie",
      MarkedDate: "2026-05-01",
      Path: path.join(os.tmpdir(), "scrubarr-missing-approved-root"),
    },
  ];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, fallback: true, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending,
    revalidation: approvedRevalidation(pending),
    deleteItem: async () => {
      throw unavailableArrError();
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 1);
  assert.match(result.failedItems[0].DeleteError, /No approved direct deletion roots/);
});

test("live deletion can use guarded direct filesystem fallback", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-fallback-"));
  const root = path.join(directory, "media");
  const target = path.join(root, "movie");

  try {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "movie.mkv"), "media", "utf8");

    const pending = [
      {
        ItemId: "movie-1",
        Title: "Old Movie",
        Type: "Movie",
        MarkedDate: "2026-05-01",
        Path: target,
      },
    ];

    const result = await runDeletionCheck({
      settings: settings({
        dryRun: false,
        fallback: true,
        telegram: false,
        allowedRoots: [root],
      }),
      timezone: "UTC",
      now: new Date("2026-06-20T04:00:00.000Z"),
      pending,
      revalidation: approvedRevalidation(pending),
      deleteItem: async () => {
        throw unavailableArrError();
      },
    });

    assert.equal(result.status, "success");
    assert.equal(result.deletedTotal, 1);
    assert.equal(result.pending[0].DeletionMethod, "filesystem");
    await assert.rejects(fs.access(target), /ENOENT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("live deletion never uses filesystem fallback after an Arr service failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-fallback-error-"));
  const root = path.join(directory, "media");
  const target = path.join(root, "movie");

  try {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "movie.mkv"), "media", "utf8");

    const pending = [
      {
        ItemId: "movie-1",
        Title: "Old Movie",
        Type: "Movie",
        MarkedDate: "2026-05-01",
        Path: target,
      },
    ];

    const result = await runDeletionCheck({
      settings: settings({
        dryRun: false,
        fallback: true,
        telegram: false,
        allowedRoots: [root],
      }),
      timezone: "UTC",
      now: new Date("2026-06-20T04:00:00.000Z"),
      pending,
      revalidation: approvedRevalidation(pending),
      deleteItem: async () => {
        const error = new Error("Radarr delete media failed: HTTP 503 service unavailable");
        error.status = 503;
        throw error;
      },
    });

    assert.equal(result.deletedTotal, 0);
    assert.equal(result.failedTotal, 1);
    await fs.access(target);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion run log entry preserves the supplied source", () => {
  const entry = deletionRunLogEntry(
    {
      completedAt: "2026-06-20T00:00:01.000Z",
      status: "success",
      dryRun: false,
      startedAt: "2026-06-20T00:00:00.000Z",
      expiredItems: [],
      expiredMovies: 0,
      expiredSeries: 0,
      expiredTotal: 0,
      deletedItems: [],
      deletedMovies: 0,
      deletedSeries: 0,
      deletedTotal: 0,
      failedItems: [],
      failedTotal: 0,
      telegram: null,
      failureTelegram: null,
      message: "No pending items have reached their deletion date.",
    },
    { source: "scheduler" },
  );

  assert.equal(entry.source, "scheduler");
  assert.equal(entry.type, "deletion");
});
