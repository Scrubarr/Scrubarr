import { mergeSettings } from "../config/settings.js";
import { mediaServerLabel } from "../services/media-server.js";
import {
  mediaServerConnectionError,
  mediaServerStateError,
} from "../services/media-server-state.js";
import { syncDeletionLibraries } from "../services/deletion-library-sync.js";
import {
  deletionRunLogEntry,
  runDeletionCheck,
} from "../services/deletion-runner.js";
import {
  applyArrPendingTags,
  removeArrPendingTags,
} from "../services/arr-pending-tags.js";
import { sendDuePendingNotifications } from "../services/telegram.js";

function telegramReportLogMessage(summary, { dryRun = false, failure = false } = {}) {
  if (!summary || summary.enabled !== true) return null;

  const reportName = failure
    ? "Telegram deletion failure report"
    : dryRun
      ? "Telegram preview deletion report"
      : "Telegram deletion report";
  const detail = String(summary.message || "");

  if (summary.sent) {
    return { level: "info", message: `${reportName} sent` };
  }
  if (/failed|error/i.test(detail)) {
    return { level: "warn", message: `${reportName} failed` };
  }
  return { level: "info", message: `${reportName} not sent` };
}

export async function logTelegramDeletionReportSummaries(appLog, cleanupResult) {
  const summaries = [
    {
      result: cleanupResult?.telegram,
      options: { dryRun: cleanupResult?.dryRun === true },
    },
    {
      result: cleanupResult?.failureTelegram,
      options: { failure: true },
    },
  ];

  for (const summary of summaries) {
    const logEntry = telegramReportLogMessage(summary.result, summary.options);
    if (!logEntry) continue;
    await appLog[logEntry.level](logEntry.message, {
      enabled: summary.result.enabled,
      sent: summary.result.sent,
      messageCount: summary.result.messageCount,
      message: summary.result.message,
    });
  }
}

export function createMaintenanceWorkflows({
  runtime,
  stores,
  defaults,
  runLog,
  deletionStats,
  appLog,
  pendingMutations,
}) {
  let librarySyncRunning = false;

  async function syncCurrentDeletionLibraries({ source = "manual" } = {}) {
    if (librarySyncRunning) {
      return {
        enabled: false,
        skipped: true,
        message: "Library sync is already running.",
      };
    }

    librarySyncRunning = true;
    let settings = null;
    try {
      settings = mergeSettings(defaults, await stores.settingsStore.read());
      const mediaServerError = mediaServerStateError(settings);
      if (mediaServerError) {
        const error = new Error(mediaServerError.message);
        error.mediaServerResult = mediaServerError;
        throw error;
      }
      const providerLabel = mediaServerLabel(settings);
      const pending = await stores.pendingStore.read();
      const result = await syncDeletionLibraries({
        settings,
        pending,
        manifestDirectory: runtime.librarySyncManifestDirectory,
      });
      await appLog.info(`${providerLabel} Leaving Soon library sync completed`, {
        source,
        provider: providerLabel,
        enabled: result.enabled,
        pending: result.pending || 0,
        refreshed: result.refreshed === true,
        scanRequested: result.scanRequested === true,
        scanStillInProgress: result.scanStillInProgress === true,
        indexedItems: result.indexedItems || [],
        scanWarnings: result.scanWarnings || [],
        globalScanFallback: result.globalScanFallback === true,
      });
      return result;
    } catch (error) {
      await appLog.warn("Media server Leaving Soon library sync failed", {
        source,
        message: error.message,
      });
      if (!error.mediaServerResult && settings) {
        error.mediaServerResult = mediaServerConnectionError(settings);
      }
      if (settings) error.settings = settings;
      throw error;
    } finally {
      librarySyncRunning = false;
    }
  }

  async function sendScheduledTelegramNotifications() {
    return pendingMutations.run("telegram-notifications", async () => {
      const settings = mergeSettings(defaults, await stores.settingsStore.read());
      const pending = await stores.pendingStore.read();
      const result = await sendDuePendingNotifications({
        settings,
        pending,
        timezone: runtime.timezone,
      });
      if (result.sent) {
        await stores.pendingStore.write(result.pending);
      }
      await appLog.info("Telegram pending notification check completed", {
        enabled: result.enabled,
        sent: result.sent,
        due: result.due,
        messageCount: result.messageCount,
      });
      return result;
    });
  }

  async function tagPendingItems(items, { source = "manual" } = {}) {
    const settings = mergeSettings(defaults, await stores.settingsStore.read());
    const result = await applyArrPendingTags({ settings, items });
    if (result.enabled) {
      await appLog.info("Arr pending tag sync completed", {
        source,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      });
    }
    return result;
  }

  async function untagPendingItems(items, { source = "manual" } = {}) {
    const settings = mergeSettings(defaults, await stores.settingsStore.read());
    const result = await removeArrPendingTags({ settings, items });
    if (result.enabled) {
      await appLog.info("Arr pending tag removal completed", {
        source,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      });
    }
    return result;
  }

  async function runScheduledCleanup() {
    const result = await pendingMutations.run("scheduled-cleanup", async () => {
      const settings = mergeSettings(defaults, await stores.settingsStore.read());
      const pending = await stores.pendingStore.read();
      const cleanupResult = await runDeletionCheck({
        settings,
        pending,
        timezone: runtime.timezone,
      });
      if (cleanupResult.deletedTotal > 0) {
        await deletionStats.recordDeletionRun(cleanupResult, {
          baselinePending: pending,
        });
      }
      if (cleanupResult.changed) {
        await stores.pendingStore.write(cleanupResult.pending);
        await untagPendingItems(cleanupResult.deletedItems, {
          source: "deletion",
        });
      }
      if (
        cleanupResult.expiredTotal > 0 ||
        cleanupResult.deletedTotal > 0 ||
        cleanupResult.failedTotal > 0
      ) {
        await runLog.append(
          deletionRunLogEntry(cleanupResult, { source: "scheduler" }),
        );
      }
      await appLog.info("Deletion cleanup check completed", {
        dryRun: cleanupResult.dryRun,
        expired: cleanupResult.expiredTotal,
        deleted: cleanupResult.deletedTotal,
        failed: cleanupResult.failedTotal,
      });
      await logTelegramDeletionReportSummaries(appLog, cleanupResult);
      return cleanupResult;
    });

    if (result.changed) {
      result.librarySync = await syncCurrentDeletionLibraries({ source: "deletion" });
    }
    return result;
  }

  async function currentCleanupMode() {
    const settings = mergeSettings(defaults, await stores.settingsStore.read());
    return settings.CleanupRules.DryRun === true ? "preview" : "live";
  }

  return {
    currentCleanupMode,
    runScheduledCleanup,
    sendScheduledTelegramNotifications,
    syncCurrentDeletionLibraries,
    tagPendingItems,
    untagPendingItems,
  };
}
