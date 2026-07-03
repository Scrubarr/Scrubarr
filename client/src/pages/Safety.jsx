import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Database,
  LoaderCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import StatePanel from "../components/StatePanel.jsx";
import { requestJson } from "../lib/api.js";
import { mediaServerFromSettings } from "../lib/mediaServerState.js";

function displayDate(value, timezone) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function displayDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return Number(value) === 1 ? singular : pluralValue;
}

function notificationPolicyDetail(policy, daysUntilDeletion) {
  const windowText = `${daysUntilDeletion} day deletion window`;
  if (policy === "full") {
    return `Full activity for a ${windowText}: first-day summary, every pending reminder day, deletion reports, and critical alerts.`;
  }
  if (policy === "lifecycle") {
    return `Lifecycle only for a ${windowText}: first-day summary, deletion reports, and critical alerts.`;
  }
  return `Standard reminders for a ${windowText}: first-day summary, sensible milestones, deletion reports, and critical alerts.`;
}

function StatusPill({ tone, children }) {
  const classes = {
    safe: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
    warning: "border-amber-900/60 bg-amber-950/30 text-amber-200",
    danger: "border-red-900/70 bg-red-950/30 text-red-200",
    neutral: "border-line bg-white/5 text-neutral-300",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${classes[tone]}`}>
      {children}
    </span>
  );
}

function SummaryCard({ icon, label, value, detail, tone = "neutral" }) {
  const border = {
    safe: "border-emerald-900/50",
    warning: "border-amber-900/50",
    danger: "border-red-900/60",
    neutral: "border-line",
  }[tone];
  return (
    <article className={`rounded-xl border ${border} bg-panel p-5`}>
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs leading-5 text-neutral-400">{detail}</p>}
    </article>
  );
}

function ChecklistItem({ label, detail, status }) {
  const icon = {
    safe: <CheckCircle2 className="text-emerald-400" size={18} />,
    warning: <AlertTriangle className="text-amber-300" size={18} />,
    danger: <ShieldX className="text-red-300" size={18} />,
    neutral: <ShieldCheck className="text-neutral-400" size={18} />,
  }[status];
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-canvas/60 p-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-neutral-200">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-neutral-400">
          {detail}
        </span>
      </span>
    </li>
  );
}

function Section({ title, description, icon, children }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-2">
          {icon && (
            <span className="text-accent" aria-hidden="true">
              {icon}
            </span>
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        {description && (
          <p className="mt-1 text-sm text-neutral-400">{description}</p>
        )}
      </div>
      <ul className="grid gap-3 p-5 md:grid-cols-2">{children}</ul>
    </section>
  );
}

function configuredSecret(value) {
  return Boolean(value) || value === true;
}

function PendingIntegrityIssueList({ issues }) {
  return (
    <ul className="mt-2 space-y-1 text-xs leading-5 text-neutral-400">
      {issues.map((issue) => (
        <li key={issue.code || issue.message} className="flex gap-2">
          <span className="text-amber-300">-</span>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function arrReady(arr) {
  return Boolean(arr?.Url) && configuredSecret(arr?.ApiKeyConfigured);
}

function lastRunDetail(lastRun) {
  if (!lastRun) return "No scheduler run recorded.";
  if (lastRun.status !== "success") return lastRun.message || "Run failed.";

  const queued = Number(lastRun.queued || 0);
  const candidates = Number(lastRun.candidates || 0);
  const synced = Number(lastRun.librarySync?.pending || 0);
  const expired = Number(lastRun.cleanup?.expired || 0);
  const deleted = Number(lastRun.cleanup?.deleted || 0);
  const failed = Number(lastRun.cleanup?.failed || 0);
  const parts = [];

  parts.push(`${candidates} ${plural(candidates, "candidate")} found`);
  if (queued > 0) parts.push(`${queued} queued`);
  if (synced > 0) parts.push(`${synced} pending synced`);
  if (expired > 0 || deleted > 0 || failed > 0) {
    parts.push(`${deleted} deleted`);
    if (expired > 0) parts.push(`${expired} eligible`);
    if (failed > 0) parts.push(`${failed} failed`);
  }
  if (lastRun.notifications?.sent) parts.push("Telegram sent");

  return `${parts.join("; ")}.`;
}

export default function Safety() {
  const [data, setData] = useState(null);
  const [state, setState] = useState({ state: "loading", message: "" });
  const [integrityConfirmOpen, setIntegrityConfirmOpen] = useState(false);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [integrityAction, setIntegrityAction] = useState({
    state: "idle",
    message: "",
  });

  async function load() {
    setState({ state: "loading", message: "Loading safety status..." });
    try {
      const [
        settings,
        health,
        scheduler,
        pending,
        pendingSummary,
        exclusions,
        pendingIntegrity,
        mediaServerStats,
      ] = await Promise.all([
        requestJson("/api/settings"),
        requestJson("/api/health/status"),
        requestJson("/api/scheduler"),
        requestJson("/api/pending"),
        requestJson("/api/pending/summary"),
        requestJson("/api/exclusions"),
        requestJson("/api/pending/integrity"),
        requestJson("/api/dashboard/stats").then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, message: error.message }),
        ),
      ]);
      setData({
        settings,
        health,
        scheduler,
        pending,
        pendingSummary,
        exclusions,
        pendingIntegrity,
        mediaServerStats,
      });
      setState({ state: "idle", message: "" });
    } catch (error) {
      setState({ state: "error", message: error.message });
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    if (!data) return null;
    const {
      settings,
      health,
      scheduler,
      pending,
      pendingSummary,
      exclusions,
      pendingIntegrity,
      mediaServerStats,
    } = data;
    const mediaServer = mediaServerFromSettings(settings);
    const libraries = mediaServer.libraries;
    const dryRun = settings.CleanupRules.DryRun === true;
    const fallbackDeletion = settings.CleanupRules.FallbackFileDeletion === true;
    const deletionLibraries = mediaServer.config.CreateDeletionLibraries === true;
    const deletionImplemented = health.capabilities?.deletion === true;
    const schedulerEnabled = scheduler.config?.enabled === true;
    const authEnabled = settings.Auth?.Enabled === true;
    const telegramConfigured =
      settings.Telegram.Enabled &&
      configuredSecret(settings.Telegram.BotTokenConfigured) &&
      Boolean(settings.Telegram.ChatID);
    const pendingCount = Array.isArray(pending) ? pending.length : 0;
    const exclusionCount = Array.isArray(exclusions) ? exclusions.length : 0;
    const mediaServerSelected = mediaServer.selected;
    const mediaServerConfigured = mediaServer.configured;
    const mediaServerConnectionError =
      mediaServerConfigured && mediaServerStats?.ok === false
        ? mediaServerStats.message || `${mediaServer.label} connection failed`
        : "";
    const mediaServerHealthy = mediaServerConfigured && !mediaServerConnectionError;
    const radarrEnabled = settings.Arrs.Radarr.Enabled === true;
    const sonarrEnabled = settings.Arrs.Sonarr.Enabled === true;
    const radarrConfigured = radarrEnabled && arrReady(settings.Arrs.Radarr);
    const sonarrConfigured = sonarrEnabled && arrReady(settings.Arrs.Sonarr);
    const liveDeletionRisk =
      deletionImplemented && !dryRun && schedulerEnabled && pendingCount > 0;
    const blockers = [
      fallbackDeletion && "Direct media file fallback is enabled",
    ].filter(Boolean);
    const warnings = [
      liveDeletionRisk && "Pending items can be deleted by a scheduled run",
      pendingIntegrity?.staleCount > 0 && "Pending queue needs review",
      !mediaServerSelected && "Media server not selected",
      mediaServerSelected && !mediaServerConfigured && `${mediaServer.label} setup is incomplete`,
      mediaServerConnectionError && `${mediaServer.label} connection needs attention`,
      settings.Telegram.Enabled && !telegramConfigured && "Telegram is enabled but incomplete",
      authEnabled && "Built-in basic auth is enabled",
    ].filter(Boolean);
    const enabledFeatures = [
      deletionLibraries && `${mediaServer.label} Leaving Soon libraries are enabled`,
      schedulerEnabled && "Scheduler is enabled",
    ].filter(Boolean);

    return {
      dryRun,
      fallbackDeletion,
      deletionLibraries,
      deletionImplemented,
      schedulerEnabled,
      authEnabled,
      telegramConfigured,
      mediaServerSelected,
      mediaServerConfigured,
      mediaServerHealthy,
      mediaServerConnectionError,
      radarrEnabled,
      sonarrEnabled,
      radarrConfigured,
      sonarrConfigured,
      pendingCount,
      exclusionCount,
      libraries,
      liveDeletionRisk,
      nextEligible: pendingSummary?.nextEligible || null,
      pendingSummary,
      pendingIntegrity,
      blockers,
      warnings,
      enabledFeatures,
      timezone: health.timezone || scheduler.timezone,
      mediaServer,
    };
  }, [data]);

  async function removeStalePendingItems() {
    setIntegrityConfirmOpen(false);
    setIntegrityBusy(true);
    setIntegrityAction({
      state: "loading",
      message: "Rechecking pending queue before removing stale items...",
    });
    try {
      const result = await requestJson("/api/pending/stale", { method: "DELETE" });
      setIntegrityAction({
        state: "success",
        message:
          result.removedCount > 0
            ? `${result.removedCount} stale pending ${plural(result.removedCount, "item")} removed.`
            : "No stale pending items remained after the recheck.",
      });
      await load();
    } catch (error) {
      setIntegrityAction({ state: "error", message: error.message });
    } finally {
      setIntegrityBusy(false);
    }
  }

  if (state.state === "error") {
    return <StatePanel tone="error">{state.message}</StatePanel>;
  }
  if (!data || !summary) {
    return (
      <StatePanel>
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="animate-spin" size={16} />
          Loading safety status...
        </span>
      </StatePanel>
    );
  }

  const { settings, scheduler } = data;
  const overallTone = summary.blockers.length
    ? "danger"
    : summary.warnings.length
      ? "warning"
      : "safe";

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={integrityConfirmOpen}
        icon={<Trash2 size={22} />}
        title="Remove stale pending items?"
        message="Scrubarr will recheck the pending queue first, then remove only items that still do not match the current Leaving Soon queue, source path checks, or Arr records. Media files will not be deleted."
        tone="danger"
        confirmLabel="Remove stale items"
        busy={integrityBusy}
        onCancel={() => setIntegrityConfirmOpen(false)}
        onConfirm={removeStalePendingItems}
      />
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-accent">Safety check</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Safety</h1>
          <p className="mt-2 max-w-3xl text-neutral-400">
            A quick status check for scheduling, notifications, pending items,
            and deletion-related settings.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state.state === "loading"}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
        >
          {state.state === "loading" ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          Refresh
        </button>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className={
                overallTone === "danger"
                  ? "text-red-300"
                  : overallTone === "warning"
                    ? "text-amber-300"
                    : "text-emerald-400"
              }
              size={26}
            />
            <div>
              <h2 className="text-xl font-semibold">
                {overallTone === "danger"
                  ? "Action needed before the next run"
                  : overallTone === "warning"
                    ? "Review recommended"
                    : "Looks ready"}
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                {overallTone === "danger"
                  ? "A high-risk setting needs attention before the next cleanup run."
                  : summary.liveDeletionRisk
                    ? "Pending items may be deleted on the next eligible live run."
                    : overallTone === "warning"
                      ? "Review the highlighted settings before relying on scheduled cleanup."
                      : summary.deletionImplemented
                        ? "No high-risk cleanup settings need attention right now."
                      : "Scrubarr is currently set up for review and queue management."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.blockers.map((item) => (
              <StatusPill key={item} tone="danger">{item}</StatusPill>
            ))}
            {summary.blockers.length === 0 &&
              summary.warnings.map((item) => (
                <StatusPill key={item} tone="warning">{item}</StatusPill>
              ))}
            {summary.blockers.length === 0 &&
              summary.warnings.length === 0 &&
              summary.enabledFeatures.map((item) => (
                <StatusPill key={item} tone="neutral">{item}</StatusPill>
              ))}
            {summary.blockers.length === 0 &&
              summary.warnings.length === 0 &&
              summary.enabledFeatures.length === 0 && (
              <StatusPill tone="safe">No live-delete blockers</StatusPill>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={<ShieldCheck size={17} />}
          label="Run mode"
          value={summary.dryRun ? "Preview only mode" : "Live mode"}
          detail={
            summary.dryRun
              ? "Scans and queues only; media will not be deleted."
              : summary.pendingCount > 0
                ? "Pending items can be deleted after their review window."
                : "Cleanup is active; no pending items are waiting."
          }
          tone={summary.liveDeletionRisk ? "warning" : summary.dryRun ? "safe" : "neutral"}
        />
        <SummaryCard
          icon={<CalendarClock size={17} />}
          label="Scheduler"
          value={summary.schedulerEnabled ? "Enabled" : "Disabled"}
          detail={`Next run: ${displayDate(scheduler.nextRun, summary.timezone)}`}
          tone={summary.schedulerEnabled ? "neutral" : "safe"}
        />
        <SummaryCard
          icon={<Database size={17} />}
          label="Pending review"
          value={`${summary.pendingCount} ${plural(summary.pendingCount, "item")}`}
          detail={
            summary.nextEligible
              ? `${
                  summary.dryRun ? "Next review date" : "Next deletion date"
                }: ${displayDateOnly(summary.nextEligible.date)}`
              : `${summary.exclusionCount} exclusions protected`
          }
          tone={summary.liveDeletionRisk ? "warning" : summary.pendingCount > 0 ? "neutral" : "safe"}
        />
        <SummaryCard
          icon={<Clock3 size={17} />}
          label="Last run"
          value={displayDate(scheduler.lastRun?.completedAt, summary.timezone)}
          detail={lastRunDetail(scheduler.lastRun)}
          tone={scheduler.lastRun?.status === "failed" ? "danger" : "neutral"}
        />
      </div>

      {summary.pendingIntegrity?.staleCount > 0 && (
        <section
          id="pending-integrity"
          className="scroll-mt-24 rounded-xl border border-amber-800/60 bg-panel"
        >
          <div className="border-b border-line p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="text-amber-300" size={20} />
                  <h2 className="text-lg font-semibold">Pending queue needs review</h2>
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-400">
                  Scrubarr found pending records that no longer match the current
                  Leaving Soon queue, source path checks, or Arr records. These
                  records can be removed from the pending queue without deleting
                  media files.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIntegrityConfirmOpen(true)}
                disabled={integrityBusy}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-800/70 bg-red-950/30 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-900/40 disabled:opacity-60"
              >
                {integrityBusy ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                Remove stale pending items
              </button>
            </div>
            {integrityAction.message && (
              <p
                className={`mt-3 text-sm ${
                  integrityAction.state === "error"
                    ? "text-red-200"
                    : integrityAction.state === "success"
                      ? "text-emerald-300"
                      : "text-neutral-400"
                }`}
              >
                {integrityAction.message}
              </p>
            )}
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {summary.pendingIntegrity.items.slice(0, 8).map((item) => (
              <article
                key={item.key}
                className="rounded-lg border border-line bg-canvas/60 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-accent">{item.Title}</h3>
                  <StatusPill tone="neutral">{item.Type}</StatusPill>
                  {item.Year && (
                    <span className="text-xs text-neutral-400">{item.Year}</span>
                  )}
                </div>
                <PendingIntegrityIssueList issues={item.issues} />
              </article>
            ))}
          </div>
          {summary.pendingIntegrity.items.length > 8 && (
            <p className="border-t border-line px-5 py-3 text-sm text-neutral-400">
              And {summary.pendingIntegrity.items.length - 8} more pending{" "}
              {plural(summary.pendingIntegrity.items.length - 8, "item")}.
            </p>
          )}
          {summary.pendingIntegrity.warnings.length > 0 && (
            <div className="border-t border-line px-5 py-4 text-sm leading-6 text-neutral-400">
              <p className="font-medium text-neutral-300">Checks skipped</p>
              <ul className="mt-2 space-y-1">
                {summary.pendingIntegrity.warnings.map((warning) => (
                  <li key={warning}>- {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <Section
        title="Deletion safety"
        icon={<ShieldCheck size={19} />}
        description="Review the settings that control how cleanup actions are allowed."
      >
        <ChecklistItem
          status={summary.dryRun ? "safe" : summary.liveDeletionRisk ? "warning" : "neutral"}
          label="Preview only mode"
          detail={
            summary.dryRun
              ? "Enabled. Scrubarr can review and queue media without deleting it."
              : summary.liveDeletionRisk
                ? "Disabled. Expired pending items can be deleted by a scheduled live run."
                : "Disabled. Live cleanup is active, but no pending items are currently waiting."
          }
        />
        <ChecklistItem
          status={summary.fallbackDeletion ? "danger" : "safe"}
          label="Direct file deletion fallback"
          detail={
            summary.fallbackDeletion
              ? "Enabled. Scrubarr may delete media files directly if Arr deletion fails and approved media roots allow it."
              : "Disabled. Scrubarr will not directly delete media files."
          }
        />
        <ChecklistItem
          status={summary.deletionLibraries ? "safe" : "neutral"}
          label={`${summary.mediaServerSelected ? summary.mediaServer.label : "Media server"} Leaving Soon libraries`}
          detail={
            !summary.mediaServerSelected
              ? "Choose Emby or Jellyfin in Settings before Scrubarr can manage Leaving Soon libraries."
              : summary.deletionLibraries
              ? "Enabled. Scrubarr can keep Leaving Soon libraries in sync with the pending queue."
              : "Disabled. Scrubarr will not manage Leaving Soon libraries."
          }
        />
        <ChecklistItem
          status={
            summary.radarrConfigured && summary.sonarrConfigured
              ? "safe"
              : "warning"
          }
          label="Deletion method"
          detail={
            summary.radarrConfigured && summary.sonarrConfigured
              ? "Movie and series deletion can be sent through Radarr and Sonarr."
              : summary.radarrEnabled || summary.sonarrEnabled
                ? "One or more Arr connections need attention before cleanup can complete normally."
                : "Arr deletion is disabled. Scrubarr can still scan, queue, and manage Leaving Soon libraries."
          }
        />
      </Section>

      <Section
        title="Automation and notifications"
        icon={<Bell size={19} />}
        description="See what Scrubarr can do on its own schedule."
      >
        <ChecklistItem
          status={summary.schedulerEnabled ? "safe" : "neutral"}
          label="Scheduled runs"
          detail={
            summary.schedulerEnabled
              ? `Enabled. Next run is ${displayDate(scheduler.nextRun, summary.timezone)}.`
              : "Disabled. Scrubarr will not run on a timer."
          }
        />
        <ChecklistItem
          status={scheduler.running ? "warning" : "safe"}
          label="Scheduler activity"
          detail={
            scheduler.running
              ? "A scheduled run is currently active."
              : "No scheduled run is currently active."
          }
        />
        <ChecklistItem
          status={
            settings.Telegram.Enabled
              ? summary.telegramConfigured
                ? "safe"
                : "warning"
              : "neutral"
          }
          label="Telegram"
          detail={
            settings.Telegram.Enabled
              ? summary.telegramConfigured
                ? "Enabled and configured for notifications."
                : "Enabled, but token or chat ID is incomplete."
              : "Disabled. No Telegram notifications will be sent."
          }
        />
        <ChecklistItem
          status="neutral"
          label="Telegram notification policy"
          detail={notificationPolicyDetail(
            settings.Telegram.NotificationPolicy,
            settings.DeletionSchedule.DaysUntilDeletion,
          )}
        />
      </Section>

      <Section
        title="Connections and data"
        icon={<ClipboardList size={19} />}
        description="Check whether the main services and tracking data are configured."
      >
        <ChecklistItem
          status={summary.mediaServerHealthy ? "safe" : "warning"}
          label={summary.mediaServerSelected ? summary.mediaServer.label : "Media server"}
          detail={
            !summary.mediaServerSelected
              ? "Choose Emby or Jellyfin in Settings before Scrubarr can scan or manage media."
              : summary.mediaServerHealthy
              ? `Configured for ${summary.libraries.join(", ")}.`
              : summary.mediaServerConnectionError
                ? summary.mediaServerConnectionError
                : summary.mediaServer.hasServerDetails
                  ? "Server details are present, but no search libraries are selected."
                  : `${summary.mediaServer.label} server URL or API key is missing.`
          }
        />
        <ChecklistItem
          status={
            summary.radarrEnabled ? (summary.radarrConfigured ? "safe" : "warning") : "warning"
          }
          label="Radarr"
          detail={
            settings.Arrs.Radarr.Enabled
              ? summary.radarrConfigured
                ? "Enabled for movie matching and cleanup handling."
                : "Enabled, but URL or API key is incomplete."
              : "Disabled. Movie deletion through Radarr will not run."
          }
        />
        <ChecklistItem
          status={
            summary.sonarrEnabled ? (summary.sonarrConfigured ? "safe" : "warning") : "warning"
          }
          label="Sonarr"
          detail={
            settings.Arrs.Sonarr.Enabled
              ? summary.sonarrConfigured
                ? "Enabled for series matching and cleanup handling."
                : "Enabled, but URL or API key is incomplete."
              : "Disabled. Series deletion through Sonarr will not run."
          }
        />
        <ChecklistItem
          status={summary.pendingCount > 0 ? "warning" : "safe"}
          label="Pending data"
          detail={
            summary.pendingCount > 0
              ? `${summary.pendingCount} item(s) are waiting in the pending queue.`
              : "Pending queue is empty."
          }
        />
        <ChecklistItem
          status={summary.authEnabled ? "warning" : "neutral"}
          label="Built-in basic authentication"
          detail={
            summary.authEnabled
              ? "Enabled. Keep Scrubarr behind external authentication such as your reverse proxy, MFA, VPN, or SSO for exposed access."
              : "Disabled. This is recommended when access is already handled by a stronger external authentication layer."
          }
        />
      </Section>
    </div>
  );
}
