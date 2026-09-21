import fs from "node:fs/promises";
import {
  formatDeletionFailureReport,
  formatDeletionDeferredReport,
  formatDeletionReport,
  formatDryRunDeletionReport,
  formatPendingRemovalReport,
  sendTelegramMessage,
} from "./telegram.js";
import {
  deletionDeferralMessage,
  deletionDeferralNeedsAttention,
  deletionDeferralRemovesPending,
} from "./deletion-deferrals.js";
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

function pendingItemKey(item) {
  return `${item?.Type || "Media"}|${item?.ItemId || ""}`;
}

function needsDeferralNotification(item, currentPending) {
  const previous = currentPending?.DeferralNotification;
  return !previous || previous.Code !== item?.SkipCode;
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

function canUseDirectFallback(error) {
  return error?.code === "arr_delete_unavailable";
}

async function deletePendingItem({ item, settings, deleteItem }) {
  try {
    return await deleteItem(settings, item);
  } catch (arrError) {
    if (
      settings?.CleanupRules?.FallbackFileDeletion !== true ||
      !canUseDirectFallback(arrError)
    ) {
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
  const activity = session.paused ? "paused" : "currently playing";
  return `${session.title || "Media"} is ${activity} for ${session.userName || "a user"}${suffix}.`;
}

async function defaultActiveStreamChecker(settings, item) {
  if (!settings?.MediaServer) return null;
  return activeMediaSessionForItem(settings, item);
}

async function sendReport({ settings, items, formatter, fallbackMessage, sendMessage }) {
  if (settings?.Telegram?.Enabled !== true) {
    return {
      enabled: false,
      attempted: false,
      sent: false,
      messageCount: 0,
      message: "Telegram is disabled.",
    };
  }
  if (items.length === 0) {
    return {
      enabled: true,
      attempted: false,
      sent: false,
      messageCount: 0,
      message: fallbackMessage,
    };
  }
  const result = await sendMessage(settings.Telegram, formatter(items));
  return {
    enabled: true,
    attempted: true,
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
  revalidation = null,
} = {}) {
  const startedAt = now.toISOString();
  const expired = expiredPendingItems({ pending, settings, now, timezone });
  const counts = deletedCounts(expired);
  const dryRun = settings?.CleanupRules?.DryRun === true;
  const hasFinalRevalidation = Array.isArray(revalidation?.allowedItems);
  const eligibleForDeletion = !dryRun && hasFinalRevalidation
    ? revalidation.allowedItems
    : [];
  const revalidationOutcomes = !dryRun && hasFinalRevalidation
    ? [...(Array.isArray(revalidation?.deferredItems) ? revalidation.deferredItems : [])]
    : expired.map((item) => ({
      ...item,
      SkipCode: "revalidation-required",
      SkipMessage: deletionDeferralMessage("revalidation-required"),
    }));
  const removedFromPending = revalidationOutcomes.filter(
    deletionDeferralRemovesPending,
  );
  const deferred = revalidationOutcomes.filter(
    (item) => !deletionDeferralRemovesPending(item),
  );
  let telegram = null;
  let removalTelegram = null;
  let deferralTelegram = null;
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
        attempted: true,
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
      removedItems: [],
      removedMovies: 0,
      removedSeries: 0,
      removedTotal: 0,
      deferredItems: [],
      deferredTotal: 0,
      revalidationWarnings: [],
      pending,
      changed: false,
      pendingChanged: false,
      telegram,
      removalTelegram,
      deferralTelegram,
      failureTelegram,
      message: expired.length === 0
        ? "No pending items have reached their deletion date."
        : `Dry run complete: ${expired.length} item(s) would be deleted.`,
    };
  }

  const deleted = [];
  const failed = [];
  const deletedByKey = new Map();
  const deletedDate = dateStamp(now, timezone);

  for (const item of eligibleForDeletion) {
    try {
      const activeSession = await activeStreamChecker(settings, item);
      if (activeSession) {
        deferred.push({
          ...item,
          SkipCode: "media-in-use",
          SkipMessage: `Deletion deferred because media is in use: ${activePlaybackMessage(activeSession)}`,
        });
        continue;
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
      deletedByKey.set(pendingItemKey(item), nextItem);
    } catch (error) {
      failed.push({
        ...item,
        DeleteError: error.message || "Deletion failed",
      });
    }
  }

  const removedKeys = new Set(removedFromPending.map(pendingItemKey));
  let updatedPending = asList(pending)
    .filter((item) => !removedKeys.has(pendingItemKey(item)))
    .map((item) => deletedByKey.get(pendingItemKey(item)) || item);
  const deletedSummary = deletedCounts(deleted);
  const removedSummary = deletedCounts(removedFromPending);
  const pendingByKey = new Map(
    asList(pending).map((item) => [pendingItemKey(item), item]),
  );
  const deferralsToNotify = deferred.filter((item) =>
    needsDeferralNotification(item, pendingByKey.get(pendingItemKey(item))),
  );

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
      attempted: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram deletion report failed.",
    };
  }

  try {
    removalTelegram = await sendReport({
      settings,
      items: removedFromPending,
      formatter: formatPendingRemovalReport,
      fallbackMessage: "No items were removed from pending.",
      sendMessage,
    });
  } catch (error) {
    removalTelegram = {
      enabled: true,
      attempted: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram pending queue update report failed.",
    };
  }

  try {
    deferralTelegram = await sendReport({
      settings,
      items: deferralsToNotify,
      formatter: formatDeletionDeferredReport,
      fallbackMessage: deferred.length > 0
        ? "No new deletion deferrals to report."
        : "No deletions were deferred.",
      sendMessage,
    });
  } catch (error) {
    deferralTelegram = {
      enabled: true,
      attempted: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram deletion deferral report failed.",
    };
  }

  const notifiedDeferrals = deferralTelegram?.sent
    ? new Map(deferralsToNotify.map((item) => [pendingItemKey(item), item]))
    : new Map();
  if (notifiedDeferrals.size > 0) {
    updatedPending = updatedPending.map((item) => {
      const notified = notifiedDeferrals.get(pendingItemKey(item));
      if (!notified || item.Deleted) return item;
      return {
        ...item,
        DeferralNotification: {
          Code: notified.SkipCode,
          SentDate: deletedDate,
        },
      };
    });
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
      attempted: true,
      sent: false,
      messageCount: 0,
      message: error.message || "Telegram deletion failure report failed.",
    };
  }

  const completedAt = new Date().toISOString();
  const attentionDeferred = deferred.some(deletionDeferralNeedsAttention);
  const status = failed.length > 0
    ? (deleted.length > 0 || deferred.length > 0 ? "partial" : "failed")
    : attentionDeferred
      ? "partial"
      : "success";
  return {
    status,
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
    removedItems: removedFromPending,
    removedMovies: removedSummary.movies,
    removedSeries: removedSummary.series,
    removedTotal: removedSummary.total,
    deferredItems: deferred,
    deferredTotal: deferred.length,
    revalidationWarnings: Array.isArray(revalidation?.warnings)
      ? revalidation.warnings
      : [],
    pending: updatedPending,
    changed: deleted.length > 0 || removedFromPending.length > 0,
    pendingChanged:
      deleted.length > 0 || removedFromPending.length > 0 || notifiedDeferrals.size > 0,
    telegram,
    removalTelegram,
    deferralTelegram,
    failureTelegram,
    message: expired.length === 0
      ? "No pending items have reached their deletion date."
      : failed.length === 0 && !attentionDeferred
        ? `Deletion check completed safely: ${deleted.length} deleted, ${removedFromPending.length} removed from pending, ${deferred.length} protected.`
        : `Deletion run complete: ${deleted.length} deleted, ${removedFromPending.length} removed from pending, ${failed.length} failed, ${deferred.length} deferred.`,
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
    removedItems: result.removedItems,
    removedMovies: result.removedMovies,
    removedSeries: result.removedSeries,
    removedTotal: result.removedTotal,
    deferredItems: result.deferredItems,
    deferredTotal: result.deferredTotal,
    revalidationWarnings: result.revalidationWarnings,
    telegram: result.telegram,
    removalTelegram: result.removalTelegram,
    deferralTelegram: result.deferralTelegram,
    failureTelegram: result.failureTelegram,
    message: result.message,
  };
}
