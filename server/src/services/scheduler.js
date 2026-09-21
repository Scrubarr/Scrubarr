import {
  entryFromError,
  entryFromPreviewResult,
  normalizeRunIssues,
  runStatusFromStages,
} from "./run-log.js";
import { scanFailureIssue, scheduledRunIssues } from "./run-alerts.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000];
const ALERT_REMINDER_MS = 24 * 60 * 60_000;

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  frequency: "daily",
  time: "03:00",
  daysOfWeek: [0],
});

const passThroughMutations = {
  run: async (_operation, callback) => callback(),
};

function dateParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value,
    ]),
  );
}

function scheduleConfigKey(config) {
  return [
    config.enabled === true,
    config.frequency,
    config.time,
    [...config.daysOfWeek].join(","),
  ].join("|");
}

function scheduledDateKey(date, timezone) {
  const parts = dateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const WEEKDAYS = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function validateScheduleConfig(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["Schedule must be an object"];
  }
  if (typeof value.enabled !== "boolean") {
    errors.push("Enabled must be true or false");
  }
  if (!["daily", "weekly"].includes(value.frequency)) {
    errors.push("Frequency must be daily or weekly");
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time || "")) {
    errors.push("Time must use 24-hour HH:mm format");
  }
  if (
    !Array.isArray(value.daysOfWeek) ||
    value.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    errors.push("Days of week must contain values from 0 to 6");
  } else if (value.frequency === "weekly" && value.daysOfWeek.length === 0) {
    errors.push("Select at least one day for a weekly schedule");
  }
  return errors;
}

export function normalizeScheduleConfig(value = {}) {
  return {
    enabled: value.enabled === true,
    frequency: value.frequency === "weekly" ? "weekly" : "daily",
    time: typeof value.time === "string" ? value.time : DEFAULT_CONFIG.time,
    daysOfWeek: Array.isArray(value.daysOfWeek)
      ? [...new Set(value.daysOfWeek)].sort()
      : [...DEFAULT_CONFIG.daysOfWeek],
  };
}

export function nextScheduledRun(config, timezone, from = new Date()) {
  if (!config.enabled) return null;
  const [targetHour, targetMinute] = config.time.split(":").map(Number);
  const start = new Date(from.getTime() + 60_000);
  start.setUTCSeconds(0, 0);
  const limit = 8 * 24 * 60;

  for (let minute = 0; minute < limit; minute += 1) {
    const candidate = new Date(start.getTime() + minute * 60_000);
    const parts = dateParts(candidate, timezone);
    const allowedDay =
      config.frequency === "daily" ||
      config.daysOfWeek.includes(WEEKDAYS[parts.weekday]);
    if (
      allowedDay &&
      Number(parts.hour) === targetHour &&
      Number(parts.minute) === targetMinute
    ) {
      return candidate;
    }
  }
  throw new Error("Unable to calculate the next scheduled run");
}

export function nextPendingScheduledRun(
  config,
  timezone,
  { from = new Date(), lastScheduledDate = null } = {},
) {
  let nextRun = nextScheduledRun(config, timezone, from);

  // A completed run can finish shortly before its configured minute. In that
  // case, nextScheduledRun can still find the same date. Never arm a second
  // callback for a date already recorded as complete.
  if (
    nextRun &&
    lastScheduledDate &&
    scheduledDateKey(nextRun, timezone) === lastScheduledDate
  ) {
    nextRun = nextScheduledRun(
      config,
      timezone,
      new Date(nextRun.getTime() + 60_000),
    );
  }

  return nextRun;
}

function librarySyncSummary(result) {
  if (!result) return null;
  return {
    status: result.status || (result.skipped ? "skipped" : "success"),
    enabled: result.enabled === true,
    skipped: result.skipped === true,
    pending: Number(result.pending || 0),
    refreshed: result.refreshed === true,
    scanRequested: result.scanRequested === true,
    scanStillInProgress: result.scanStillInProgress === true,
    indexedItems: Array.isArray(result.indexedItems) ? result.indexedItems : [],
    scanWarnings: Array.isArray(result.scanWarnings) ? result.scanWarnings : [],
    queueCleanupWarnings: Array.isArray(result.queueCleanupWarnings)
      ? result.queueCleanupWarnings
      : [],
    linksRemoved: Number(result.linksRemoved || 0),
    removalRetries: Number(result.removalRetries || 0),
    message: result.message || "",
  };
}

function notificationSummary(result) {
  if (!result) return null;
  return {
    status: result.status || (result.sent ? "sent" : "skipped"),
    enabled: result.enabled === true,
    sent: result.sent === true,
    due: Number(result.due || 0),
    messageCount: Number(result.messageCount || 0),
    message: result.message || "",
  };
}

function cleanupSummary(result) {
  if (!result) return null;
  return {
    status: result.status || "success",
    dryRun: result.dryRun === true,
    expired: Number(result.expiredTotal || 0),
    deleted: Number(result.deletedTotal || 0),
    removed: Number(result.removedTotal || 0),
    failed: Number(result.failedTotal || 0),
    deferred: Number(result.deferredTotal || 0),
    revalidationWarnings: Array.isArray(result.revalidationWarnings)
      ? result.revalidationWarnings
      : [],
    message: result.message || "",
  };
}

function runSummary(
  result,
  startedAt,
  completedAt,
  librarySync,
  notifications,
  cleanup,
  issues,
) {
  return {
    status: runStatusFromStages({ librarySync, notifications, cleanup }),
    startedAt,
    completedAt,
    readOnly: result.readOnly !== false,
    scanned: result.summary.scanned,
    candidates: result.candidates.length,
    candidateMovies: result.summary.candidateMovies,
    candidateSeries: result.summary.candidateSeries,
    queued: Number(result.queue?.added || 0),
    queuedMovies: Number(result.queue?.movies || 0),
    queuedSeries: Number(result.queue?.series || 0),
    warnings: result.warnings || [],
    issues: normalizeRunIssues(issues),
    librarySync: librarySyncSummary(librarySync),
    notifications: notificationSummary(notifications),
    cleanup: cleanupSummary(cleanup),
  };
}

export class SchedulerService {
  constructor({
    store,
    scanCoordinator,
    timezone,
    runLog,
    librarySync,
    notifications,
    cleanup,
    arrTagging,
    pendingMutations = passThroughMutations,
    runHealthNotification = async () => ({ sent: false }),
    onAlertError = async () => {},
  }) {
    this.store = store;
    this.scanCoordinator = scanCoordinator;
    this.timezone = timezone;
    this.runLog = runLog || { append: async () => {} };
    this.librarySync = librarySync || (async () => null);
    this.notifications = notifications || (async () => null);
    this.cleanup = cleanup || (async () => null);
    this.arrTagging = arrTagging || (async () => null);
    this.pendingMutations = pendingMutations;
    this.runHealthNotification = runHealthNotification;
    this.onAlertError = onAlertError;
    this.alertQueue = Promise.resolve();
    this.timer = null;
    this.nextRun = null;
    this.scheduleGeneration = 0;
    this.activeScheduledDate = null;
    this.state = {
      config: structuredClone(DEFAULT_CONFIG),
      lastRun: null,
      lastScheduledDate: null,
      runAlert: null,
    };
  }

  async start() {
    const saved = await this.store.read();
    this.state = {
      config: normalizeScheduleConfig(saved.config),
      lastRun: saved.lastRun || null,
      runAlert: saved.runAlert || null,
      lastScheduledDate:
        typeof saved.lastScheduledDate === "string"
          ? saved.lastScheduledDate
          : null,
    };
    this.scheduleTimer();
  }

  stop() {
    this.scheduleGeneration += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextRun = null;
  }

  status() {
    return {
      ...structuredClone(this.state),
      timezone: this.timezone,
      nextRun: this.nextRun?.toISOString() || null,
      running: this.scanCoordinator.isBusy(),
      mode: "preview",
    };
  }

  async update(config) {
    const normalized = normalizeScheduleConfig(config);
    const errors = validateScheduleConfig(normalized);
    if (errors.length > 0) {
      const error = new Error(errors.join(". "));
      error.code = "invalid_schedule";
      error.details = errors;
      throw error;
    }
    this.state.config = normalized;
    await this.persist();
    this.scheduleTimer();
    return this.status();
  }

  async runNow({ scheduledDate = null } = {}) {
    if (scheduledDate && this.state.lastScheduledDate === scheduledDate) {
      this.scheduleTimer();
      return this.state.lastRun;
    }
    if (scheduledDate && this.activeScheduledDate === scheduledDate) {
      return this.state.lastRun;
    }

    if (scheduledDate) this.activeScheduledDate = scheduledDate;
    const generation = this.scheduleGeneration;
    const startedAt = new Date().toISOString();
    let queueCommitted = false;
    try {
      try {
        const { added, result } = await this.pendingMutations.run(
          "scheduled-queue-commit",
          () =>
            this.scanCoordinator.commitEligibleCandidates({
              timezone: this.timezone,
            }),
        );
        queueCommitted = true;
        let tagging = null;
        try {
          tagging = await this.arrTagging(added || []);
        } catch {
          // Arr pending tags are helpful context, but they should not fail a
          // scheduled run after the Scrubarr queue has already been updated.
          tagging = { status: "failed" };
        }
        let librarySync = null;
        try {
          librarySync = await this.librarySync();
        } catch (error) {
          librarySync = {
            status: "failed",
            enabled: false,
            refreshed: false,
            message: error.message || "Library sync failed",
          };
        }
        let notifications = null;
        try {
          notifications = await this.notifications();
        } catch (error) {
          notifications = {
            status: "failed",
            enabled: true,
            sent: false,
            due: 0,
            messageCount: 0,
            message: error.message || "Telegram notification failed",
          };
        }
        let cleanup = null;
        try {
          cleanup = await this.cleanup();
        } catch (error) {
          cleanup = {
            status: "failed",
            dryRun: false,
            expiredTotal: 0,
            deletedTotal: 0,
            failedTotal: 0,
            message: error.message || "Cleanup failed",
          };
        }
        const completedAt = new Date().toISOString();
        const issues = normalizeRunIssues(
          scheduledRunIssues({
            result,
            tagging,
            librarySync,
            notifications,
            cleanup,
          }),
        );
        this.state.lastRun = runSummary(
          result,
          startedAt,
          completedAt,
          librarySync,
          notifications,
          cleanup,
          issues,
        );
        if (scheduledDate) this.state.lastScheduledDate = scheduledDate;
        await this.runLog.append(
          entryFromPreviewResult({
            source: "scheduler",
            result,
            startedAt,
            completedAt,
            librarySync,
            notifications,
            cleanup,
            issues,
          }),
        );
        await this.reportRunHealth(issues);
      } catch (error) {
        error.retryableBeforeCommit = !queueCommitted &&
          (error.retryableBeforeCommit === true || error.code === "pending_queue_busy");
        const issues = normalizeRunIssues([scanFailureIssue(error)]);
        const failedEntry = entryFromError({
          source: "scheduler",
          type: "scan",
          error,
          startedAt,
          issues,
        });
        this.state.lastRun = {
          status: "failed",
          startedAt,
          completedAt: failedEntry.completedAt,
          readOnly: !queueCommitted,
          message: error.message || "Scheduled scan failed",
          issues,
        };
        await this.reportRunHealth(issues);
        await this.runLog.append(failedEntry);
        await this.persist();
        throw error;
      }
      await this.persist();
      if (this.scheduleGeneration === generation) this.scheduleTimer();
      return this.state.lastRun;
    } finally {
      if (scheduledDate === this.activeScheduledDate) {
        this.activeScheduledDate = null;
      }
    }
  }

  async persist() {
    await this.store.write(this.state);
  }

  reportRunHealth(issues) {
    const delivery = this.alertQueue.then(() => this.updateRunAlert(issues));
    this.alertQueue = delivery.catch(() => {});
    return delivery;
  }

  async updateRunAlert(issues) {
    const key = [...new Set(issues.map((issue) => issue.key))].sort().join("|");
    const previous = this.state.runAlert;
    if (!key && !previous) return;
    if (key && key === previous?.key && Date.now() - Date.parse(previous.sentAt) < ALERT_REMINDER_MS) return;
    try {
      const delivery = await this.runHealthNotification({ issues });
      if (delivery?.sent) {
        this.state.runAlert = key ? { key, sentAt: new Date().toISOString() } : null;
        await this.persist();
      }
    } catch (error) {
      // A broken notification transport must not stop the scheduler or replay completed work.
      try {
        await this.onAlertError(error);
      } catch {
        // Logging is best-effort when the notification transport is already unavailable.
      }
    }
  }

  scheduleTimer(retry = null) {
    this.stop();
    const scheduleGeneration = this.scheduleGeneration;
    let nextRun = nextPendingScheduledRun(
      this.state.config,
      this.timezone,
      {
        lastScheduledDate: this.state.lastScheduledDate,
      },
    );
    if (!nextRun) return;
    const retryAllowed = retry &&
      retry.attempt <= RETRY_DELAYS_MS.length &&
      retry.scheduledDate === scheduledDateKey(new Date(), this.timezone) &&
      retry.scheduledDate !== this.state.lastScheduledDate &&
      retry.runAt < nextRun;
    if (retryAllowed) nextRun = retry.runAt;
    this.nextRun = nextRun;
    const configKey = scheduleConfigKey(this.state.config);
    const scheduledDate = retryAllowed ? retry.scheduledDate : scheduledDateKey(nextRun, this.timezone);
    const attempt = retryAllowed ? retry.attempt : 0;
    const delay = Math.min(nextRun.getTime() - Date.now(), 2_147_000_000);
    this.timer = setTimeout(async () => {
      if (
        scheduleGeneration !== this.scheduleGeneration ||
        configKey !== scheduleConfigKey(this.state.config)
      ) {
        return;
      }
      if (retryAllowed && scheduledDateKey(new Date(), this.timezone) !== scheduledDate) {
        this.scheduleTimer();
        return;
      }
      try {
        await this.runNow({ scheduledDate });
      } catch (error) {
        console.error(`Scheduled scan failed: ${error.message}`);
        if (scheduleGeneration !== this.scheduleGeneration) return;
        this.scheduleTimer(error.retryableBeforeCommit && attempt < RETRY_DELAYS_MS.length
          ? { scheduledDate, attempt: attempt + 1, runAt: new Date(Date.now() + RETRY_DELAYS_MS[attempt]) }
          : null);
      }
    }, Math.max(delay, 1000));
    this.timer.unref?.();
  }
}
