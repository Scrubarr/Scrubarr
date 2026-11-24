import { setTimeout as delay } from "node:timers/promises";
import { isActivePendingItem } from "./pending-state.js";
import { externalServiceFailure, fetchExternal } from "./external-error.js";

import { deletionDeferralReason } from "./deletion-deferrals.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const TIMEOUT_MS = 10000;
const MAX_SEND_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAIT_MS = 5000;
const RETRYABLE_CONNECT_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_NOTIFICATION_MILESTONES = [20, 10, 5, 1];

export const TELEGRAM_NOTIFICATION_POLICIES = Object.freeze([
  "full",
  "standard",
  "lifecycle",
]);

function titleOf(item) {
  return String(item?.Title || "Untitled").replace(/\r?\n/g, " ").trim();
}

export function escapeTelegramHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sortByTitle(items) {
  return [...items].sort((left, right) =>
    titleOf(left).localeCompare(titleOf(right), undefined, {
      sensitivity: "base",
    }),
  );
}

function mediaGroups(items) {
  return [
    ["Movies", "Movie", "🎬"],
    ["Series", "Series", "📺"],
  ].map(([label, type, icon]) => ({
    label,
    type,
    icon,
    items: items.filter((item) => item.Type === type),
  }));
}

export function withScrubarrFooter(lines) {
  if (lines.at(-1) !== "") lines.push("");
  lines.push("🧼 <i>Scrubarr-dub-dub</i> 🧼");
  return lines.join("\n").trim();
}

function dateOnlyInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDateFromDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Date.UTC(year, month - 1, day);
}

function daysSinceDateOnly(value, now, timezone) {
  const markedUtc = utcDateFromDateOnly(value);
  const todayUtc = utcDateFromDateOnly(dateOnlyInTimezone(now, timezone));
  if (markedUtc === null || todayUtc === null) return null;
  return Math.max(0, Math.floor((todayUtc - markedUtc) / DAY_MS));
}

function asIntegerList(value) {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isInteger(item))
    : [];
}

function normalizeNotificationPolicy(value) {
  return TELEGRAM_NOTIFICATION_POLICIES.includes(value) ? value : "standard";
}

export function notificationDaysForPolicy({ daysUntilDeletion, policy } = {}) {
  const deletionWindow = Number(daysUntilDeletion);
  if (!Number.isInteger(deletionWindow) || deletionWindow < 1) return [];

  const selectedPolicy = normalizeNotificationPolicy(policy);
  if (selectedPolicy === "full") {
    return Array.from({ length: deletionWindow }, (_value, index) => deletionWindow - index);
  }

  const days = [deletionWindow];
  if (selectedPolicy === "lifecycle") {
    return days;
  }

  for (const milestone of STANDARD_NOTIFICATION_MILESTONES) {
    if (milestone > deletionWindow) continue;
    if (milestone !== deletionWindow && deletionWindow - milestone < 2) continue;
    days.push(milestone);
  }

  return [...new Set(days)].sort((left, right) => right - left);
}

export function formatPendingNotification(items) {
  const lines = ["<b>🧽 Scrubarr - Pending Deletions ⏱</b>", ""];

  for (const group of mediaGroups(items)) {
    if (group.items.length === 0) continue;
    lines.push(`<b>${group.icon} ${group.label}</b>`, "");

    const byDays = new Map();
    for (const item of group.items) {
      const days = Number.isInteger(item.DaysRemaining)
        ? item.DaysRemaining
        : 0;
      if (!byDays.has(days)) byDays.set(days, []);
      byDays.get(days).push(item);
    }

    for (const days of [...byDays.keys()].sort((left, right) => right - left)) {
      lines.push(`<u>${days} ${days === 1 ? "day" : "days"} remaining:</u>`);
      for (const item of sortByTitle(byDays.get(days))) {
        lines.push(`• ${escapeTelegramHtml(titleOf(item))}`);
      }
      lines.push("");
    }
  }

  return withScrubarrFooter(lines);
}

export function findDuePendingNotifications({
  pending,
  settings,
  now = new Date(),
  timezone = "UTC",
}) {
  const daysUntilDeletion = Number(settings?.DeletionSchedule?.DaysUntilDeletion);
  const notificationDays = new Set(
    notificationDaysForPolicy({
      daysUntilDeletion,
      policy: settings?.Telegram?.NotificationPolicy,
    }),
  );
  if (!Number.isInteger(daysUntilDeletion) || notificationDays.size === 0) {
    return [];
  }

  return (Array.isArray(pending) ? pending : [])
    .map((item, index) => {
      if (!isActivePendingItem(item)) return null;
      const elapsedDays = daysSinceDateOnly(item.MarkedDate, now, timezone);
      if (elapsedDays === null) return null;
      const daysRemaining = daysUntilDeletion - elapsedDays;
      const notified = new Set(asIntegerList(item.Notified));
      if (!notificationDays.has(daysRemaining) || notified.has(daysRemaining)) {
        return null;
      }
      return { item, index, daysRemaining };
    })
    .filter(Boolean);
}

export async function sendDuePendingNotifications({
  settings,
  pending,
  now = new Date(),
  timezone = "UTC",
  sendMessage = sendTelegramMessage,
} = {}) {
  if (settings?.Telegram?.Enabled !== true) {
    return {
      enabled: false,
      sent: false,
      due: 0,
      messageCount: 0,
      pending,
      message: "Telegram is disabled.",
    };
  }

  const due = findDuePendingNotifications({ pending, settings, now, timezone });
  if (due.length === 0) {
    return {
      enabled: true,
      sent: false,
      due: 0,
      messageCount: 0,
      pending,
      message: "No pending Telegram notifications are due.",
    };
  }

  let result;
  try {
    result = await sendMessage(
      settings.Telegram,
      formatPendingNotification(
        due.map(({ item, daysRemaining }) => ({
          ...item,
          DaysRemaining: daysRemaining,
        })),
      ),
    );
  } catch (error) {
    return {
      status: "failed",
      enabled: true,
      sent: false,
      due: due.length,
      messageCount: error.messageCount ?? 0,
      pending,
      message: error.message || "Telegram notification failed",
    };
  }
  const updated = (Array.isArray(pending) ? pending : []).map((item) => ({
    ...item,
    Notified: asIntegerList(item.Notified),
  }));

  for (const { index, daysRemaining } of due) {
    const notified = new Set(asIntegerList(updated[index]?.Notified));
    notified.add(daysRemaining);
    updated[index] = {
      ...updated[index],
      Notified: [...notified].sort((left, right) => right - left),
    };
  }

  return {
    enabled: true,
    sent: true,
    due: due.length,
    messageCount: result.messageCount,
    pending: updated,
    message: `Sent ${due.length} pending Telegram notification item(s).`,
  };
}

function formatItemSections(items) {
  const lines = [];
  for (const group of mediaGroups(items)) {
    if (group.items.length === 0) continue;
    lines.push(`<b>${group.icon} ${group.label}</b>`);
    for (const item of sortByTitle(group.items)) {
      lines.push(`• ${escapeTelegramHtml(titleOf(item))}`);
    }
    lines.push("");
  }
  return lines;
}

function formatDeferredItemSections(items, { kept = false } = {}) {
  const lines = [];
  for (const group of mediaGroups(items)) {
    if (group.items.length === 0) continue;
    lines.push(`<b>${group.icon} ${group.label}</b>`);
    for (const item of sortByTitle(group.items)) {
      const title = escapeTelegramHtml(titleOf(item));
      const reason = kept && item.SkipCode === "age-rule-not-met"
        ? "Its watch history no longer meets the cleanup age requirement."
        : deletionDeferralReason(item.SkipCode);
      lines.push(`• ${kept ? `<b>${title}</b>` : title}`);
      lines.push(`  ${kept ? "" : "Reason: "}${escapeTelegramHtml(reason)}`);
    }
    lines.push("");
  }
  return lines;
}

function deletionSummaryLines(items) {
  const groups = mediaGroups(items);
  const movies = groups.find((group) => group.type === "Movie")?.items.length || 0;
  const series = groups.find((group) => group.type === "Series")?.items.length || 0;
  return [`Movies deleted: ${movies}`, `Series deleted: ${series}`, ""];
}

export function formatDeletionReport(items) {
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Deletion Report ☠</b>",
    "",
    ...deletionSummaryLines(items),
    "<i>Items deleted today:</i>",
    "",
    ...formatItemSections(items),
  ]);
}

export function formatDryRunDeletionReport(items) {
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Preview Only Deletion Report 🔎</b>",
    "",
    "<i>Items that would have been deleted today:</i>",
    "",
    ...formatItemSections(items),
    "<b>No media files were actually deleted because Preview only mode is enabled.</b>",
  ]);
}

export function formatDeletionFailureReport(items) {
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Deletion Failures ⚠️</b>",
    "",
    "These items could not be deleted:",
    "",
    ...formatItemSections(items),
    "Review the Scrubarr logs before retrying.",
  ]);
}

export function formatDeletionDeferredReport(items) {
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Deletion Deferred for Safety 🛡</b>",
    "",
    "These due items were not deleted and remain pending:",
    "",
    ...formatDeferredItemSections(items),
    "Scrubarr will check them again during the next scheduled deletion run.",
  ]);
}

export function formatPendingRemovalReport(items) {
  return withScrubarrFooter([
    "<b>↩️ Scrubarr · Kept in library</b>",
    "",
    "Scrubarr removed these items from Pending Deletions because they no longer qualify.",
    "",
    ...formatDeferredItemSections(items, { kept: true }),
    "These items can be queued again if they qualify later.",
  ]);
}

export function formatTestMessage() {
  return withScrubarrFooter([
    "<b>🧽 Scrubarr - Test Message ✅</b>",
    "",
    "Telegram is configured correctly.",
    "No scan or deletion was performed.",
  ]);
}

export function splitTelegramMessage(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];
  const parts = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function sendFailure(detail, options = {}) {
  return externalServiceFailure({
    service: "Telegram",
    operation: "send message",
    detail,
    ...options,
  });
}

function beforeTelegramRequest(error) {
  const networkError = error.cause?.cause ?? error.cause;
  return RETRYABLE_CONNECT_CODES.has(networkError?.code) ||
    (networkError?.syscall === "connect" && networkError.code === "ETIMEDOUT") ||
    (networkError?.code === "ECONNRESET" &&
      /before secure TLS connection was established/i.test(networkError.message));
}

async function sendTelegramPart(config, message, fetchImpl, wait) {
  const body = JSON.stringify({
    chat_id: config.ChatID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    const canRetry = attempt < MAX_SEND_ATTEMPTS;
    const response = await fetchExternal({
      service: "Telegram",
      operation: "send message",
      url: `https://api.telegram.org/bot${config.BotToken}/sendMessage`,
      timeoutMs: TIMEOUT_MS,
      fetchImpl,
      allowedStatuses: [429],
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json", Connection: "close" },
        body,
      },
    }).catch((error) => {
      if (beforeTelegramRequest(error)) {
        if (canRetry) return null;
        throw error;
      }
      // Telegram sendMessage has no idempotency key. An uncertain send must not be replayed.
      if (!error.status || error.status >= 500 || error.status === 408) {
        throw sendFailure(`${error.safeDetail || "connection interrupted"}; delivery unconfirmed`, {
          status: error.status,
          cause: error,
        });
      }
      throw error;
    });

    if (!response) {
      await wait(500 * attempt);
      continue;
    }
    const data = await response.json().catch(() => null);
    if (response.status === 429) {
      const retryAfter = data?.parameters?.retry_after ?? response.headers?.get("Retry-After") ?? 1;
      const numericWait = Number(retryAfter) * 1000;
      const waitMs = Number.isFinite(numericWait) ? Math.max(1000, numericWait) : Infinity;
      if (!canRetry || waitMs > MAX_RATE_LIMIT_WAIT_MS) {
        throw sendFailure("rate limited; try again later", { status: 429 });
      }
      await wait(waitMs);
      continue;
    }
    if (data?.ok === true) return;
    if (data?.ok === false) {
      throw sendFailure(data.description || "Telegram rejected the message");
    }
    throw sendFailure("could not read Telegram's response; delivery unconfirmed");
  }
}

export async function sendTelegramMessage(config, text, fetchImpl = fetch, wait = delay) {
  if (!config.BotToken || !config.ChatID) {
    throw new Error("Telegram bot token and Chat ID are required");
  }

  const messages = splitTelegramMessage(text);
  for (const [index, message] of messages.entries()) {
    try {
      await sendTelegramPart(config, message, fetchImpl, wait);
    } catch (error) {
      throw Object.assign(error, { messageCount: index });
    }
  }
  return { messageCount: messages.length };
}
