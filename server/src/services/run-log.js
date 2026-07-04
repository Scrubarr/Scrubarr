import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES = 200;

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function runTypeForPreviewSource(source) {
  return source === "scheduler" ? "scan" : "preview";
}

export function entryFromPreviewResult({
  source,
  result,
  startedAt,
  completedAt,
  librarySync,
  notifications,
  cleanup,
}) {
  return {
    id: `${completedAt}-${source}`,
    source,
    type: runTypeForPreviewSource(source),
    status: "success",
    startedAt,
    completedAt,
    readOnly: result.readOnly !== false,
    scanned: Number(result.summary?.scanned || 0),
    candidates: Array.isArray(result.candidates) ? result.candidates.length : 0,
    candidateMovies: Number(result.summary?.candidateMovies || 0),
    candidateSeries: Number(result.summary?.candidateSeries || 0),
    queued: Number(result.queue?.added || 0),
    queuedMovies: Number(result.queue?.movies || 0),
    queuedSeries: Number(result.queue?.series || 0),
    existingPendingMovies: Number(result.summary?.existingPendingMovies || 0),
    existingPendingSeries: Number(result.summary?.existingPendingSeries || 0),
    skipped: result.summary?.skipped || {},
    warnings: asList(result.warnings).map(String),
    librarySync: librarySync
      ? {
          status: librarySync.status || (librarySync.skipped ? "skipped" : "success"),
          enabled: librarySync.enabled === true,
          skipped: librarySync.skipped === true,
          pending: Number(librarySync.pending || 0),
          refreshed: librarySync.refreshed === true,
          scanRequested: librarySync.scanRequested === true,
          scanStillInProgress: librarySync.scanStillInProgress === true,
          indexedItems: Array.isArray(librarySync.indexedItems)
            ? librarySync.indexedItems
            : [],
          scanWarnings: Array.isArray(librarySync.scanWarnings)
            ? librarySync.scanWarnings
            : [],
          message: safeString(librarySync.message),
        }
      : null,
    notifications: notifications
      ? {
          status: notifications.status || (notifications.sent ? "sent" : "skipped"),
          enabled: notifications.enabled === true,
          sent: notifications.sent === true,
          due: Number(notifications.due || 0),
          messageCount: Number(notifications.messageCount || 0),
          message: safeString(notifications.message),
        }
      : null,
    cleanup: cleanup
      ? {
          status: cleanup.status || "success",
          dryRun: cleanup.dryRun === true,
          expired: Number(cleanup.expiredTotal || 0),
          deleted: Number(cleanup.deletedTotal || 0),
          failed: Number(cleanup.failedTotal || 0),
          message: safeString(cleanup.message),
        }
      : null,
  };
}

export function entryFromError({ source, type = "preview", error, startedAt }) {
  const completedAt = new Date().toISOString();
  return {
    id: `${completedAt}-${source}`,
    source,
    type,
    status: "failed",
    startedAt,
    completedAt,
    readOnly: true,
    message: safeString(error?.message, "Run failed"),
  };
}

export class RunLogService {
  constructor(store) {
    this.store = store;
  }

  async list({ limit = 100 } = {}) {
    return asList(await this.store.read()).slice(0, limit);
  }

  async append(entry) {
    const current = asList(await this.store.read());
    const next = [entry, ...current].slice(0, MAX_ENTRIES);
    await this.store.write(next);
    return entry;
  }

  async file() {
    const fileName = path.basename(this.store.filePath || "RunLog.json");
    if (!this.store.filePath) {
      return { fileName, content: `${JSON.stringify(asList(await this.store.read()), null, 2)}\n` };
    }

    try {
      return {
        fileName,
        content: await fs.readFile(this.store.filePath, "utf8"),
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { fileName, content: "[]\n" };
      }
      throw error;
    }
  }
}
