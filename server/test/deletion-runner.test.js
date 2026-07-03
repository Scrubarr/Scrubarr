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
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "Pacific/Auckland",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-31" },
      { ItemId: "series-1", Title: "New Series", Type: "Series", MarkedDate: "2026-06-19" },
    ],
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

test("live deletion keeps failed items pending and sends failure report", async () => {
  const sent = [];
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: true }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
    ],
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
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      { ItemId: "movie-1", Title: "Old Movie", Type: "Movie", MarkedDate: "2026-05-01" },
    ],
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
  assert.equal(result.status, "failed");
  assert.equal(result.deletedTotal, 0);
  assert.equal(result.failedTotal, 1);
  assert.match(result.failedItems[0].DeleteError, /Active stream detected/);
});

test("live deletion direct filesystem fallback requires approved roots", async () => {
  const result = await runDeletionCheck({
    settings: settings({ dryRun: false, fallback: true, telegram: false }),
    timezone: "UTC",
    now: new Date("2026-06-20T04:00:00.000Z"),
    pending: [
      {
        ItemId: "movie-1",
        Title: "Old Movie",
        Type: "Movie",
        MarkedDate: "2026-05-01",
        Path: path.join(os.tmpdir(), "scrubarr-missing-approved-root"),
      },
    ],
    deleteItem: async () => {
      throw new Error("Radarr unavailable");
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

    const result = await runDeletionCheck({
      settings: settings({
        dryRun: false,
        fallback: true,
        telegram: false,
        allowedRoots: [root],
      }),
      timezone: "UTC",
      now: new Date("2026-06-20T04:00:00.000Z"),
      pending: [
        {
          ItemId: "movie-1",
          Title: "Old Movie",
          Type: "Movie",
          MarkedDate: "2026-05-01",
          Path: target,
        },
      ],
      deleteItem: async () => {
        throw new Error("Radarr unavailable");
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
