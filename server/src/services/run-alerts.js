import {
  sendTelegramMessage,
  withScrubarrFooter,
} from "./telegram.js";

const SERVICES = new Set(["Emby", "Jellyfin", "Radarr", "Sonarr", "Telegram"]);
const TELEGRAM_REPORTS = new Map([
  ["notifications", "Pending deletion reminder"],
  ["deletion-report", "Deletion report"],
  ["pending-removal-report", "Pending list update"],
  ["deferral-report", "Postponed deletion report"],
  ["failure-report", "Deletion failure report"],
]);
const CLEANUP_ISSUES = new Map([
  ["scan", "Scrubarr couldn’t finish the scan or update the pending list."],
  ["tagging", "Some pending items couldn’t be tagged in Radarr or Sonarr."],
  ["libraries", "The Leaving Soon libraries couldn’t be fully updated."],
  ["cleanup", "There was a problem checking or deleting due items."],
  ["queue-cleanup", "The Leaving Soon libraries couldn’t be fully updated after deletion."],
  ["pending-tag-removal", "Some pending tags couldn’t be removed in Radarr or Sonarr."],
  ["deletion-revalidation", "Some final safety checks need review."],
]);

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

function cleanupIssueText(key) {
  const service = key.startsWith("connection:") ? key.slice("connection:".length) : null;
  if (SERVICES.has(service)) return `Scrubarr couldn’t complete a request to ${service}.`;
  return CLEANUP_ISSUES.get(key) || "A cleanup step needs review.";
}

function formatHealthAlert(title, lines) {
  return withScrubarrFooter([`<b>${title}</b>`, "", ...lines]);
}

export function formatRunHealthNotification({ issues, previousIssueKeys = [] }) {
  if (issues.length === 0) {
    const telegramOnly = previousIssueKeys.length > 0 &&
      previousIssueKeys.every((key) => TELEGRAM_REPORTS.has(key));
    return formatHealthAlert("✅ Scrubarr · Run back to normal", [
      "The latest cleanup run finished successfully.",
      ...(telegramOnly ? ["The previous warning was about Telegram delivery."] : []),
    ]);
  }

  // Format from known keys so exception details stay in the logs.
  const keys = [...new Set(issues.map((issue) => issue.key))];
  const reports = keys.filter((key) => TELEGRAM_REPORTS.has(key));
  const cleanup = keys.filter((key) => !TELEGRAM_REPORTS.has(key));
  const deliveryLines = reports.length > 0 ? [
    "Scrubarr couldn’t confirm delivery of the following:",
    ...reports.map((key) => `• ${TELEGRAM_REPORTS.get(key)}`),
    "",
  ] : [];
  const logs = "See <b>Scrubarr → Logs</b> for the run details.";

  if (cleanup.length === 0) {
    return formatHealthAlert("⚠️ Scrubarr · Telegram delivery", [
      "Cleanup finished.", "", ...deliveryLines, logs,
    ]);
  }
  return formatHealthAlert("⚠️ Scrubarr · Cleanup needs attention", [
    ...cleanup.map((key) => `• ${cleanupIssueText(key)}`), "",
    ...deliveryLines,
    logs,
  ]);
}

export async function sendRunHealthNotification(settings, event, sendMessage = sendTelegramMessage) {
  if (settings.Telegram?.Enabled !== true) return { enabled: false, sent: false };
  const result = await sendMessage(settings.Telegram, formatRunHealthNotification(event));
  return { enabled: true, sent: true, messageCount: result.messageCount };
}
