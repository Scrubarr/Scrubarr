import fs from "node:fs/promises";
import {
  formatDeletionFailureReport,
  formatDeletionReport,
  formatDryRunDeletionReport,
  sendTelegramMessage,
} from "./telegram.js";
import { deleteViaArr } from "./arr-delete.js";
import { assertSafeDirectDeletionPath } from "./direct-delete-guard.js";
import { dateOnlyInTimezone, daysSinceDateOnly } from "./date-utils.js";
import { activeMediaSessionForItem } from "./media-server.js";
import { activePendingItems } from "./pending-state.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function deletedCounts(items) {
  const movies = items.filter((item) => item.Type === "Movie").length;
  const series = items.filter((item) => item.Type === "Series").length;
  return { movies, series, total: movies + series };
}

function dateStamp(now, timezone) {
  return dateOnlyInTimezone(now, timezone);
}

async function deleteViaFileSystem(item, settings) {
  if (!item.Path) throw new Error("Media path is missing");
  const safePath = await assertSafeDirectDeletionPath({
    targetPath: item.Path,
    allowedRoots: settings?.CleanupRules?.DirectFileDeletionAllowedRoots,
  });
  await fs.rm(safePath.path, { recursive: true });
  return { method: "filesystem", message: "Deleted directly from filesystem after path guard" };
}

async function deletePendingItem({ item, settings, deleteItem }) {
  try {
    return await deleteItem(settings, item);
  } catch (arrError) {
    if (settings?.CleanupRules?.FallbackFileDeletion !== true) {
      throw arrError;
    }
    try {
      return await deleteViaFileSystem(item, settings);
    } catch (fileError) {
      throw new Error(
        `Arr delete failed: ${arrError.message}. File fallback failed: ${fileError.message}`,
      );
    }
  }
}

function activePlaybackMessage(session) {
  const location = [session.client, session.deviceName].filter(Boolean).join(" on ");
  const suffix = location ? ` (${location})` : "";
  return `${session.title || "Media"} is currently playing for ${session.userName}${suffix}.`;
}

async function defaultActiveStreamChecker(settings, item) {
  if (!settings?.MediaServer) return null;
  return activeMediaSessionForItem(settings, item);
}

async function sendReport({ settings, items, formatter, fallbackMessage, sendMessage }) {
  if (settings?.Telegram?.Enabled !== true) {
    return {
      enabled: false,
      sent: false,
      messageCount: 0,
      message: "Telegram is disabled.",
    };
  }
  if (items.length === 0) {
    return {
      enabled: true,
      sent: false,
      messageCount: 0,
      message: fallbackMessage,
    };
  }
  const result = await sendMessage(settings.Telegram, formatter(items));
  return {
    enabled: true,
    sent: true,
    messageCount: result.messageCount,
    message: `Sent Telegram report for ${items.length} item(s).`,
  };
}

export function expiredPendingItems({
  pending,
  settings,
  now = new Date(),
  timezone = "UTC",
}) {
  const daysUntilDeletion = Number(settings?.DeletionSchedule?.DaysUntilDeletion);
  if (!Number.isInteger(daysUntilDeletion) || daysUntilDeletion < 1) return [];

  return activePendingItems(pending)
    .map((item) => {
      const ageDays = daysSinceDateOnly(item.MarkedDate, now, timezone);
      if (ageDays === null || ageDays < daysUntilDeletion) return null;
      return {
        ...item,
        PendingAgeDays: ageDays,
        DaysOverdue: ageDays - daysUntilDeletion,
      };
    })
    .filter(Boolean);
}

export async function runDeletionCheck({
  settings,
  pending,
  timezone,
  now = new Date(),
  sendMessage = sendTelegramMessage,
  deleteItem = deleteViaArr,
  activeStreamChecker = defaultActiveStreamChecker,
} = {}) {
  const startedAt = now.toISOString();
  const expired = expiredPendingItems({ pending, settings, now, timezone });
  const counts = deletedCounts(expired);
  const dryRun = settings?.CleanupRules?.DryRun === true;
  let telegram = null;
  let failureTelegram = null;

  if (dryRun) {
    try {
      telegram = await sendReport({
        settings,
        items: expired,
        formatter: formatDryRunDeletionReport,
        fallbackMessage: "No expired pending items.",
        sendMessage,
      });
    } catch (error) {
      telegram = {
        enabled: true,
        sent: false,
        messageCount: 0,
        message: error.message || "Telegram dry-run deletion report failed.",
      };
    }

    const completedAt = new Date().toISOString();
    return {
      status: "success",
      type: "deletion",
      dryRun: true,
      startedAt,
      completedAt,
      expiredItems: expired,
      expiredMovies: counts.movies,
      expiredSeries: counts.series,
      expiredTotal: counts.total,
      deletedItems: [],
      deletedMovies: 0,
      deletedSeries: 0,
      deletedTotal: 0,
      failedItems: [],
      failedTotal: 0,
      pending,
      changed: false,
      telegram,
      failureTelegram,
      message: expired.length === 0
        ? "No pending items have reached their deletion date."
        : `Dry run complete: ${expired.length} item(s) would be deleted.`,
    };
  }

  const deleted = [];
  const failed = [];
  const deletedById = new Map();
  const deletedDate = dateStamp(now, timezone);

  for (const item of expired) {
    try {
      const activeSession = await activeStreamChecker(settings, item);
      if (activeSession) {
        throw new Error(`Active stream detected: ${activePlaybackMessage(activeSession)}`);
      }
      const deletion = await deletePendingItem({ item, settings, deleteItem });
      const nextItem = {
        ...item,
        Deleted: deletedDate,
        DeletedDate: deletedDate,
        DeletionMethod: deletion.method,
        DeletionMessage: deletion.message,
      };
      deleted.push(nextItem);
      deletedById.set(String(item.ItemId), nextItem);
    } catch (error) {
      failed.push({
        ...item,
        DeleteError: error.message || "Deletion failed",
      });
    }
  }

  const updatedPending = asList(pending).map((item) =>
    deletedById.get(String(item.ItemId)) || item,
  );
  const deletedSummary = deletedCounts(deleted);

  try {
    telegram = await sendReport({
      settings,
      items: deleted,
      formatter: formatDeletionReport,
      fallbackMessage: "No items were deleted.",
      sendMessage,
    });
  } catch (error) {
    telegram = {
      enabled: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram deletion report failed.",
    };
  }

  try {
    failureTelegram = await sendReport({
      settings,
      items: failed,
      formatter: formatDeletionFailureReport,
      fallbackMessage: "No deletion failures.",
      sendMessage,
    });
  } catch (error) {
    failureTelegram = {
      enabled: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram deletion failure report failed.",
    };
  }

  const completedAt = new Date().toISOString();
  return {
    status: failed.length > 0 ? (deleted.length > 0 ? "partial" : "failed") : "success",
    type: "deletion",
    dryRun: false,
    startedAt,
    completedAt,
    expiredItems: expired,
    expiredMovies: counts.movies,
    expiredSeries: counts.series,
    expiredTotal: counts.total,
    deletedItems: deleted,
    deletedMovies: deletedSummary.movies,
    deletedSeries: deletedSummary.series,
    deletedTotal: deletedSummary.total,
    failedItems: failed,
    failedTotal: failed.length,
    pending: updatedPending,
    changed: deleted.length > 0,
    telegram,
    failureTelegram,
    message: expired.length === 0
      ? "No pending items have reached their deletion date."
      : `Deletion run complete: ${deleted.length} deleted, ${failed.length} failed.`,
  };
}

export function deletionRunLogEntry(result, { source = "manual" } = {}) {
  return {
    id: `${result.completedAt}-deletion`,
    source,
    type: "deletion",
    status: result.status,
    dryRun: result.dryRun,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    expiredItems: result.expiredItems,
    expiredMovies: result.expiredMovies,
    expiredSeries: result.expiredSeries,
    expiredTotal: result.expiredTotal,
    deletedItems: result.deletedItems,
    deletedMovies: result.deletedMovies,
    deletedSeries: result.deletedSeries,
    deletedTotal: result.deletedTotal,
    failedItems: result.failedItems,
    failedTotal: result.failedTotal,
    telegram: result.telegram,
    failureTelegram: result.failureTelegram,
    message: result.message,
  };
}
