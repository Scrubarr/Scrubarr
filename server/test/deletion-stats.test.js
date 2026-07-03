import assert from "node:assert/strict";
import test from "node:test";
import {
  DeletionStatsService,
  countDeletedHistory,
  normalizeDeletionStats,
} from "../src/services/deletion-stats.js";

class MemoryStore {
  constructor(value) {
    this.value = value;
  }

  async read() {
    return structuredClone(this.value);
  }

  async write(value) {
    this.value = structuredClone(value);
  }
}

test("counts deleted pending history by media type", () => {
  assert.deepEqual(
    countDeletedHistory([
      { ItemId: "movie-1", Type: "Movie", Deleted: "2026-06-20" },
      { ItemId: "series-1", Type: "Series", DeletedDate: "2026-06-20" },
      { ItemId: "active-1", Type: "Movie", Deleted: null },
    ]),
    { movies: 1, series: 1, total: 2 },
  );
});

test("initializes deletion stats from existing deleted pending history", async () => {
  const store = new MemoryStore({});
  const pendingStore = new MemoryStore([
    { ItemId: "movie-1", Type: "Movie", Deleted: "2026-06-20" },
    { ItemId: "active-1", Type: "Movie", Deleted: null },
  ]);
  const stats = new DeletionStatsService(store, { pendingStore });

  const current = await stats.current();

  assert.equal(current.initialized, true);
  assert.deepEqual(current.allTime, { movies: 1, series: 0, total: 1 });
  assert.deepEqual((await store.read()).allTime, { movies: 1, series: 0, total: 1 });
});

test("recordDeletionRun seeds from old history then adds the current run once", async () => {
  const store = new MemoryStore({});
  const stats = new DeletionStatsService(store);

  const current = await stats.recordDeletionRun(
    {
      dryRun: false,
      completedAt: "2026-06-26T00:00:00.000Z",
      deletedItems: [
        { ItemId: "series-1", Type: "Series" },
        { ItemId: "movie-2", Type: "Movie" },
      ],
      deletedMovies: 1,
      deletedSeries: 1,
      deletedTotal: 2,
    },
    {
      baselinePending: [
        { ItemId: "movie-1", Type: "Movie", Deleted: "2026-06-20" },
      ],
    },
  );

  assert.deepEqual(current.allTime, { movies: 2, series: 1, total: 3 });
  assert.deepEqual(current.lastDeletion, {
    completedAt: "2026-06-26T00:00:00.000Z",
    movies: 1,
    series: 1,
    total: 2,
  });
});

test("recordDeletionRun does not increment dry runs or empty deletion checks", async () => {
  const store = new MemoryStore({
    initialized: true,
    allTime: { movies: 2, series: 1, total: 3 },
  });
  const stats = new DeletionStatsService(store);

  await stats.recordDeletionRun({ dryRun: true, deletedTotal: 4 });
  await stats.recordDeletionRun({ dryRun: false, deletedTotal: 0 });

  assert.deepEqual((await store.read()).allTime, { movies: 2, series: 1, total: 3 });
});

test("normalizes older or malformed deletion stats safely", () => {
  assert.deepEqual(
    normalizeDeletionStats({
      initialized: true,
      allTime: { movies: 2, series: "3" },
      lastDeletion: { movies: 1, total: 1 },
    }),
    {
      version: 1,
      initialized: true,
      initializedAt: null,
      updatedAt: null,
      allTime: { movies: 2, series: 3, total: 5 },
      lastDeletion: { completedAt: null, movies: 1, series: 0, total: 1 },
    },
  );
});
