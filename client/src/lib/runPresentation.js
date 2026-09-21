const RUN_OUTCOMES = {
  completed: {
    key: "completed",
    label: "Completed",
    tone: "success",
  },
  protected: {
    key: "protected",
    label: "Completed with protected items",
    tone: "success",
  },
  warning: {
    key: "warning",
    label: "Completed with warnings",
    tone: "warning",
  },
  partial: {
    key: "partial",
    label: "Partially completed",
    tone: "warning",
  },
  failed: {
    key: "failed",
    label: "Failed",
    tone: "error",
  },
  unknown: {
    key: "unknown",
    label: "Status unavailable",
    tone: "neutral",
  },
};

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function queueWarningText(warning) {
  if (typeof warning === "string") return warning.trim();
  if (!warning || typeof warning !== "object") return "";
  const type = textValue(warning.type) || "Queue";
  const title = textValue(warning.title) || "Unknown item";
  const reason = textValue(warning.reason) || "Managed queue cleanup failed.";
  return `${type}: ${title}: ${reason}`;
}

function reportDeliveryProblem(report, label) {
  const attemptedFailure = report?.attempted === true && report?.sent !== true;
  const legacyFailure = report?.attempted === undefined && report?.enabled &&
    !report.sent && /failed|error|forbidden|aborted/i.test(report.message || "");
  if (!attemptedFailure && !legacyFailure) {
    return "";
  }
  return label;
}

export function collectRunProblems(entry = {}) {
  const values = [
    ...asList(entry.issues).map((issue) =>
      typeof issue === "string" ? issue : issue?.label,
    ),
    ...asList(entry.warnings),
    ...asList(entry.librarySync?.scanWarnings),
    ...asList(entry.librarySync?.queueCleanupWarnings).map(queueWarningText),
    ...asList(entry.revalidationWarnings),
    reportDeliveryProblem(entry.telegram, "Telegram deletion report was not delivered."),
    reportDeliveryProblem(entry.removalTelegram, "Telegram pending queue update report was not delivered."),
    reportDeliveryProblem(entry.deferralTelegram, "Telegram deletion deferral report was not delivered."),
    reportDeliveryProblem(entry.failureTelegram, "Telegram deletion failure report was not delivered."),
  ];
  const seen = new Set();
  return values
    .map(textValue)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function stageHasProblem(stage) {
  if (!stage || typeof stage !== "object") return false;
  const status = String(stage.status || "").toLowerCase();
  return (
    status === "failed" ||
    status === "partial" ||
    Number(stage.failed || stage.failedTotal || 0) > 0
  );
}

export function getRunOutcome(entry = {}) {
  const status = String(entry.status || "").toLowerCase();
  if (status === "failed") return RUN_OUTCOMES.failed;

  const stages = [
    entry.tagging,
    entry.librarySync,
    entry.notifications,
    entry.cleanup,
    entry.cleanup?.librarySync,
  ];
  if (
    status === "partial" ||
    Number(entry.failedTotal || 0) > 0 ||
    asList(entry.failedItems).length > 0 ||
    stages.some(stageHasProblem)
  ) {
    return RUN_OUTCOMES.partial;
  }
  if (collectRunProblems(entry).length > 0) return RUN_OUTCOMES.warning;
  if (Number(entry.deferredTotal || 0) > 0) return RUN_OUTCOMES.protected;
  if (status === "success") return RUN_OUTCOMES.completed;
  return RUN_OUTCOMES.unknown;
}

export function isDeletionRelatedLog(entry = {}) {
  return (
    ["deletion", "delete", "cleanup"].includes(entry.type) ||
    Number(
      entry.expiredTotal ||
      entry.deletedTotal ||
      entry.removedTotal ||
      entry.failedTotal ||
      0,
    ) > 0
  );
}

export function isActualDeletionRecord(entry = {}) {
  return isDeletionRelatedLog(entry) && entry.dryRun !== true;
}

export function runTitle(entry = {}) {
  if (isDeletionRelatedLog(entry)) {
    return entry.source === "scheduler" ? "Scheduled deletion check" : "Deletion check";
  }
  if (entry.source === "scheduler" && ["scan", "preview"].includes(entry.type)) {
    return "Scheduled scan";
  }
  if (entry.type === "preview") return "Preview scan";
  if (entry.type === "scan") return "Scan";
  const source = entry.source || "Scrubarr";
  const type = entry.type || "run";
  return `${source} ${type}`.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function runModeLabel(entry = {}) {
  if (isDeletionRelatedLog(entry)) {
    return entry.dryRun ? "Preview only mode" : "Live mode";
  }
  if (entry.cleanup) {
    return entry.cleanup.dryRun ? "Preview only mode" : "Live mode";
  }
  if (entry.readOnly) return "Preview only mode";
  return "";
}

export function runTimestamp(entry = {}) {
  const value = entry.completedAt || entry.startedAt;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validTimeZone(timeZone) {
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function displayRunDate(value, timeZone) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  const zone = validTimeZone(timeZone) || browserTimeZone();
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(date);
  } catch {
    return "Not available";
  }
}

export function calendarDate(value, timeZone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const zone = validTimeZone(timeZone) || browserTimeZone();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function runDuration(entry = {}) {
  const started = entry.startedAt ? new Date(entry.startedAt) : null;
  const completed = entry.completedAt ? new Date(entry.completedAt) : null;
  if (
    !started ||
    !completed ||
    Number.isNaN(started.getTime()) ||
    Number.isNaN(completed.getTime())
  ) {
    return "";
  }
  const seconds = Math.max(0, Math.round((completed - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function deletionCounts(entry = {}) {
  const deletedItems = asList(entry.deletedItems);
  const expiredItems = asList(entry.expiredItems);
  const failedItems = asList(entry.failedItems);
  const removedItems = asList(entry.removedItems);
  const deferredItems = asList(entry.deferredItems);
  return {
    expired: Number(entry.expiredTotal ?? expiredItems.length ?? 0),
    deleted: Number(entry.deletedTotal ?? deletedItems.length ?? 0),
    failed: Number(entry.failedTotal ?? failedItems.length ?? 0),
    removed: Number(entry.removedTotal ?? removedItems.length ?? 0),
    deferred: Number(entry.deferredTotal ?? deferredItems.length ?? 0),
    movies: Number(
      entry.deletedMovies ??
        deletedItems.filter((item) => ["Movie", "movie"].includes(item.Type || item.type)).length,
    ),
    series: Number(
      entry.deletedSeries ??
        deletedItems.filter((item) => ["Series", "series"].includes(item.Type || item.type)).length,
    ),
  };
}

export function runSummary(entry = {}) {
  if (isDeletionRelatedLog(entry)) {
    const counts = deletionCounts(entry);
    if (entry.dryRun) {
      return `${counts.expired} would delete, ${counts.deferred} deferred, ${counts.failed} failed`;
    }
    return `${counts.expired} due, ${counts.deleted} deleted, ${counts.removed} removed from pending, ${counts.deferred} deferred, ${counts.failed} failed`;
  }
  const candidates = Number(entry.candidates || 0);
  return `${Number(entry.scanned || 0)} scanned, ${candidates} ${candidates === 1 ? "candidate" : "candidates"}, ${Number(entry.queued || 0)} queued`;
}

export function filterRunEntries(
  entries,
  { result = "all", from = "", to = "", timeZone } = {},
) {
  return asList(entries).filter((entry) => {
    const outcome = getRunOutcome(entry).key;
    if (result === "warnings" && collectRunProblems(entry).length === 0) return false;
    if (result === "problems" && !["failed", "partial"].includes(outcome)) return false;
    if (from || to) {
      const date = calendarDate(entry.completedAt || entry.startedAt, timeZone);
      if (!date) return false;
      if (from && date < from) return false;
      if (to && date > to) return false;
    }
    return true;
  });
}

export function paginateRunEntries(entries, size = 5, requestedPage = 1) {
  const list = asList(entries);
  const pageSize = size === "all"
    ? Math.max(1, list.length)
    : Math.max(1, Number.parseInt(size, 10) || 5);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(requestedPage, 10) || 1), totalPages);
  const startIndex = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    totalPages,
    startIndex,
    entries: list.slice(startIndex, startIndex + pageSize),
  };
}

export function findScheduledRunEntry(lastRun, entries) {
  if (!lastRun?.completedAt) return null;
  return asList(entries).find(
    (entry) =>
      entry.source === "scheduler" &&
      ["scan", "preview"].includes(entry.type) &&
      entry.completedAt === lastRun.completedAt,
  ) || null;
}

export function scheduledRunLink(lastRun, entries = []) {
  if (!lastRun?.completedAt) return "";
  const matched = findScheduledRunEntry(lastRun, entries);
  const id = matched?.id || `${lastRun.completedAt}-scheduler`;
  return `/logs?run=${encodeURIComponent(id)}`;
}

export function lastRunDetail(lastRun) {
  if (!lastRun) return "No scheduler run recorded.";
  if (getRunOutcome(lastRun).key === "failed") {
    return lastRun.message || "Run failed.";
  }
  const parts = [
    `${Number(lastRun.candidates || 0)} candidate${Number(lastRun.candidates || 0) === 1 ? "" : "s"} found`,
  ];
  if (Number(lastRun.queued || 0) > 0) parts.push(`${lastRun.queued} queued`);
  if (Number(lastRun.librarySync?.pending || 0) > 0) {
    parts.push(`${lastRun.librarySync.pending} pending synced`);
  }
  const cleanup = lastRun.cleanup || {};
  if (Number(cleanup.deleted || 0) > 0) parts.push(`${cleanup.deleted} deleted`);
  if (Number(cleanup.removed || 0) > 0) {
    parts.push(`${cleanup.removed} removed from pending`);
  }
  if (Number(cleanup.failed || 0) > 0) parts.push(`${cleanup.failed} failed`);
  if (Number(cleanup.deferred || 0) > 0) parts.push(`${cleanup.deferred} deferred`);
  return `${parts.join("; ")}.`;
}
