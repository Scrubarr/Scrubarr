import { hasDeletionMarker } from "./pending-state.js";

const STATS_VERSION = 1;

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function countItems(items) {
  const movies = asList(items).filter((item) => item.Type === "Movie" || item.type === "Movie").length;
  const series = asList(items).filter((item) => item.Type === "Series" || item.type === "Series").length;
  return { movies, series, total: movies + series };
}

function safeCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeCounts(value = {}) {
  const movies = safeCount(value.movies);
  const series = safeCount(value.series);
  return {
    movies,
    series,
    total: safeCount(value.total) || movies + series,
  };
}

function defaultStats() {
  return {
    version: STATS_VERSION,
    initialized: false,
    initializedAt: null,
    updatedAt: null,
    allTime: { movies: 0, series: 0, total: 0 },
    lastDeletion: null,
  };
}

export function countDeletedHistory(pending) {
  return countItems(asList(pending).filter(hasDeletionMarker));
}

export function normalizeDeletionStats(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return {
    version: STATS_VERSION,
    initialized: source.initialized === true,
    initializedAt: typeof source.initializedAt === "string" ? source.initializedAt : null,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
    allTime: normalizeCounts(source.allTime),
    lastDeletion: source.lastDeletion && typeof source.lastDeletion === "object"
      ? {
          completedAt: typeof source.lastDeletion.completedAt === "string"
            ? source.lastDeletion.completedAt
            : null,
          movies: safeCount(source.lastDeletion.movies),
          series: safeCount(source.lastDeletion.series),
          total: safeCount(source.lastDeletion.total),
        }
      : null,
  };
}

export class DeletionStatsService {
  constructor(store, { pendingStore } = {}) {
    this.store = store;
    this.pendingStore = pendingStore;
  }

  async current({ pending } = {}) {
    const stored = normalizeDeletionStats(await this.store.read());
    if (stored.initialized) return stored;

    const sourcePending = pending || (this.pendingStore ? await this.pendingStore.read() : []);
    const now = new Date().toISOString();
    const initialized = {
      ...defaultStats(),
      initialized: true,
      initializedAt: now,
      updatedAt: now,
      allTime: countDeletedHistory(sourcePending),
    };
    await this.store.write(initialized);
    return initialized;
  }

  async recordDeletionRun(result, { baselinePending } = {}) {
    const deletedItems = asList(result?.deletedItems);
    const deleted = deletedItems.length > 0
      ? countItems(deletedItems)
      : normalizeCounts({
          movies: result?.deletedMovies,
          series: result?.deletedSeries,
          total: result?.deletedTotal,
        });

    if (result?.dryRun === true || deleted.total <= 0) {
      return this.current({ pending: baselinePending });
    }

    const current = await this.current({ pending: baselinePending });
    const next = {
      ...current,
      updatedAt: result?.completedAt || new Date().toISOString(),
      allTime: {
        movies: current.allTime.movies + deleted.movies,
        series: current.allTime.series + deleted.series,
        total: current.allTime.total + deleted.total,
      },
      lastDeletion: {
        completedAt: result?.completedAt || null,
        movies: deleted.movies,
        series: deleted.series,
        total: deleted.total,
      },
    };
    await this.store.write(next);
    return next;
  }
}
