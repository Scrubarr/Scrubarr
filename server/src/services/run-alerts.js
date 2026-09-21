import {
  escapeTelegramHtml,
  sendTelegramMessage,
  withScrubarrFooter,
} from "./telegram.js";

const SERVICES = new Set(["Emby", "Jellyfin", "Radarr", "Sonarr", "Telegram"]);

export function scanFailureIssue(error) {
  const service = SERVICES.has(error?.service) ? error.service : null;
  return {
    key: service ? `connection:${service}` : "scan",
    label: service ? `${service} connection or request failed` : "Scan or queue update failed",
  };
}

export function scheduledRunIssues({ result, tagging, librarySync, notifications, cleanup }) {
  const issues = (result?.connectionFailures || [])
    .filter((service) => SERVICES.has(service))
    .map((service) => ({ key: `connection:${service}`, label: `${service} connection or request failed` }));
  for (const [key, label, stage] of [
    ["tagging", "Arr pending tags could not all be applied", tagging],
    ["libraries", "Leaving Soon library sync needs attention", librarySync],
    ["notifications", "Pending Telegram notifications failed", notifications],
    ["cleanup", "Deletion check needs attention", cleanup],
    ["queue-cleanup", "Leaving Soon sync after deletion needs attention", cleanup?.librarySync],
    ["pending-tag-removal", "Arr pending tags could not all be removed", cleanup?.untagging],
  ]) {
    const syncWarning = stage?.scanWarnings?.length > 0 || stage?.queueCleanupWarnings?.length > 0 ||
      stage?.links?.some((link) => (link.writable === false && link.pending > 0) || link.skipped?.length > 0);
    if (["failed", "partial"].includes(stage?.status) || Number(stage?.failed || stage?.failedTotal || 0) > 0 || syncWarning) {
      issues.push({ key, label });
    }
  }
  if (Array.isArray(cleanup?.revalidationWarnings) && cleanup.revalidationWarnings.length > 0) {
    issues.push({
      key: "deletion-revalidation",
      label: "Final deletion safety checks completed with warnings",
    });
  }
  for (const [key, label, report] of [
    ["deletion-report", "Telegram deletion report was not delivered", cleanup?.telegram],
    ["pending-removal-report", "Telegram pending queue update report was not delivered", cleanup?.removalTelegram],
    ["deferral-report", "Telegram deletion deferral report was not delivered", cleanup?.deferralTelegram],
    ["failure-report", "Telegram deletion failure report was not delivered", cleanup?.failureTelegram],
  ]) {
    const attemptedFailure = report?.attempted === true && report?.sent !== true;
    const legacyFailure = report?.attempted === undefined &&
      report?.enabled && !report.sent && /failed|error|forbidden|aborted/i.test(report.message || "");
    if (attemptedFailure || legacyFailure) {
      issues.push({ key, label });
    }
  }
  return issues;
}

export function formatRunHealthNotification({ issues }) {
  if (issues.length === 0) {
    return withScrubarrFooter([
      "<b>🧽 Scrubarr - Scheduled runs recovered ✅</b>", "",
      "The latest scheduled run completed without the previously reported issues.",
      "Check Logs for its queue and deletion results.",
    ]);
  }
  // Use fixed labels, not exception messages: errors may contain credentials or host paths.
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Scheduled run needs attention ⚠️</b>", "",
    ...issues.map((issue) => `- ${escapeTelegramHtml(issue.label)}`), "",
    "Open Scrubarr > Logs for details. Some work may be incomplete.",
    "Only temporary failures before queue changes can be retried automatically. Completed work is not replayed.",
  ]);
}

export async function sendRunHealthNotification(settings, event, sendMessage = sendTelegramMessage) {
  if (settings.Telegram?.Enabled !== true) return { enabled: false, sent: false };
  const result = await sendMessage(settings.Telegram, formatRunHealthNotification(event));
  return { enabled: true, sent: true, messageCount: result.messageCount };
}
