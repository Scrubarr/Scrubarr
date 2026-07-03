import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CircleAlert,
  ClipboardList,
  Globe2,
  HardDrive,
  History,
  LoaderCircle,
  Server,
  ShieldPlus,
  Trash2,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ConfirmMediaDetail from "../components/ConfirmMediaDetail.jsx";
import MediaMeta from "../components/MediaMeta.jsx";
import MediaPoster from "../components/MediaPoster.jsx";
import QualificationPopover from "../components/QualificationPopover.jsx";
import StatePanel from "../components/StatePanel.jsx";
import MediaTypeBadge, { MediaIcon } from "../components/MediaTypeBadge.jsx";
import { requestJson } from "../lib/api.js";
import { mediaServerFromStatus } from "../lib/mediaServerState.js";

function Stat({ label, value, compact = false }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="text-sm text-neutral-400">{label}</div>
      <div
        className={`mt-2 font-semibold tracking-tight ${
          compact ? "text-lg leading-snug" : "text-3xl"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function LibraryTypeBadge({ type, label, compact = false }) {
  const isSeriesLike = type === "Series" || type === "Episode";
  const classes = isSeriesLike
    ? "border-purple-500/30 bg-purple-500/15 text-purple-200"
    : "border-blue-500/30 bg-blue-500/15 text-blue-200";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${classes} ${
        compact ? "px-2 py-0.5 text-xs" : "px-2 py-1"
      }`}
    >
      <MediaIcon type={type} size={compact ? 12 : 13} />
      {label || type || "Item"}
    </span>
  );
}

function LibraryTotalCard({
  type,
  label,
  value,
  badgeLabel,
  secondary,
  className = "",
}) {
  const isTotal = type === "Total";

  if (secondary) {
    return (
      <div className={`rounded-xl border border-line bg-canvas/60 p-4 ${className}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-5">
          <div className="flex min-w-0 flex-col items-center text-center">
            <LibraryTypeBadge type={type} label={badgeLabel} />
            <div className="mt-4 text-3xl font-semibold tracking-tight">
              {value}
            </div>
            <div className="mt-1 text-sm text-neutral-400">{label}</div>
          </div>
          <div className="h-full w-px bg-line/70" aria-hidden="true" />
          <div className="flex min-w-0 flex-col items-center text-center">
            <LibraryTypeBadge
              type={secondary.type}
              label={secondary.badgeLabel}
            />
            <div className="mt-4 text-3xl font-semibold tracking-tight">
              {secondary.value}
            </div>
            <div className="mt-1 text-sm text-neutral-400">
              {secondary.label}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-line bg-canvas/60 p-4 text-center ${className}`}>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {isTotal ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-1 text-neutral-300">
            <Server size={13} />
            Total
          </span>
        ) : (
          <LibraryTypeBadge type={type} label={badgeLabel} />
        )}
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-neutral-400">{label}</div>
    </div>
  );
}

function formatDate(value, timezone) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone || undefined,
  }).format(new Date(value));
}

function dateOnlyToLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function deletionDateTimeFromEligibleDate(value, scheduler) {
  const target = dateOnlyToLocalDate(value);
  if (!target) return null;

  const nextRun = scheduler?.nextRun ? new Date(scheduler.nextRun) : null;
  if (nextRun instanceof Date && !Number.isNaN(nextRun.getTime())) {
    target.setHours(nextRun.getHours(), nextRun.getMinutes(), 0, 0);
  }

  return target;
}

function sameLocalDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatNextDeletion(value, scheduler, now = new Date()) {
  const target = deletionDateTimeFromEligibleDate(value, scheduler);
  if (!target) return "Date unknown";

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const prefix = sameLocalDate(target, now)
    ? "Today"
    : sameLocalDate(target, tomorrow)
      ? "Tomorrow"
      : ["Sun", "Mon", "Tues", "Wed", "Thu", "Fri", "Sat"][target.getDay()];

  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(target);

  return `${prefix}, ${date} at ${formatClockTime(target)}`;
}

function formatClockTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function countdownParts(targetDate, now) {
  if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) return null;
  const totalSeconds = Math.max(
    0,
    Math.ceil((targetDate.getTime() - now.getTime()) / 1000),
  );

  return {
    due: totalSeconds === 0,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function padTime(value) {
  return String(value).padStart(2, "0");
}

function formatLiveCountdown(targetDate, parts) {
  if (parts.days === 0) {
    const values = [];
    if (parts.hours > 0) values.push(`${parts.hours}h`);
    if (parts.hours > 0 || parts.minutes > 0) {
      values.push(`${padTime(parts.minutes)}m`);
    }
    values.push(`${padTime(parts.seconds)}s`);
    return values.join(" ");
  }

  const dayLabel = parts.days === 1 ? "day" : "days";
  return `${parts.days} ${dayLabel}, ${parts.hours}h ${padTime(parts.minutes)}m`;
}

function LiveCountdown({ targetDate, now, mode }) {
  const parts = countdownParts(targetDate, now);
  if (!parts) return <span>No pending items</span>;

  if (parts.due) {
    return (
      <span className="block leading-snug">
        <span className="block text-2xl font-semibold leading-snug tracking-tight text-red-200">
          Due now
        </span>
        {mode === "preview" && (
          <span className="mt-1 block text-xs font-medium text-amber-200">
            Preview only mode enabled
          </span>
        )}
      </span>
    );
  }

  const countdown = formatLiveCountdown(targetDate, parts);

  return (
    <span className="block">
      <span className="block min-w-0 break-words text-lg font-semibold leading-snug tracking-tight text-neutral-100">
        {countdown}
      </span>
      {mode === "preview" && (
        <span className="mt-2 block text-xs font-medium text-amber-200">
          Preview only mode enabled
        </span>
      )}
    </span>
  );
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
}

function countdownText(countdown, mode) {
  if (!countdown || countdown.DaysRemaining === null) return "Deletion date unknown";
  if (countdown.DaysRemaining === 0) {
    return mode === "preview"
      ? "Would be deleted today"
      : "Will be deleted today";
  }
  if (countdown.DaysRemaining === 1) {
    return mode === "preview"
      ? "Would be deleted tomorrow"
      : "Will be deleted tomorrow";
  }
  return mode === "preview"
    ? `Would be deleted in ${countdown.DaysRemaining} days`
    : `Will be deleted in ${countdown.DaysRemaining} days`;
}

function CountdownValue({ countdown, mode }) {
  return (
    <span className="block leading-snug">
      <span className="block">{countdownText(countdown, mode)}</span>
      {mode === "preview" && (
        <span className="mt-1 block text-xs font-medium text-amber-200">
          Preview only mode enabled
        </span>
      )}
    </span>
  );
}

function countdownTone(daysRemaining, mode) {
  if (mode === "preview") return "border-amber-800/50 bg-amber-950/20 text-amber-100";
  if (daysRemaining === 0) return "border-red-900/60 bg-red-950/25 text-red-200";
  if (daysRemaining <= 1) return "border-amber-800/50 bg-amber-950/20 text-amber-100";
  return "border-line bg-canvas/60 text-neutral-300";
}

function countdownPanelTone(daysRemaining, mode) {
  if (mode === "preview") return "border-amber-800/50 bg-amber-950/15 text-amber-100";
  if (daysRemaining === 0) return "border-red-900/60 bg-red-950/25 text-red-200";
  return "border-line bg-canvas/60 text-neutral-300";
}

function storageTone(freePercent) {
  if (freePercent <= 10) return "bg-red-500";
  if (freePercent <= 25) return "bg-amber-400";
  return "bg-emerald-500";
}

function StorageDisk({ disk }) {
  const usedPercent = Math.min(Math.max(Number(disk.usedPercent || 0), 0), 100);
  const freePercent = Math.max(100 - usedPercent, 0);
  const barTone = storageTone(freePercent);

  return (
    <div className="rounded-xl border border-line bg-canvas/60 px-4 py-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(9rem,13rem)_1fr_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neutral-200">
            <HardDrive size={16} className="shrink-0 text-accent" />
            <span className="truncate" title={disk.label || disk.root}>
              {disk.label || disk.root}
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            {disk.mediaCount} media item{disk.mediaCount === 1 ? "" : "s"}
          </p>
        </div>

        {disk.available ? (
          <>
            <div className="min-w-0">
              <div className="h-2.5 overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full rounded-full ${barTone}`}
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-neutral-400">
                <span>{formatBytes(disk.usedBytes)} used</span>
                <span>{formatBytes(disk.totalBytes)} total</span>
              </div>
            </div>
            <div className="text-left lg:text-right">
              <div className="text-sm font-semibold text-neutral-200">
                {formatBytes(disk.freeBytes)} free
              </div>
              <div className="text-xs text-neutral-400">{freePercent.toFixed(1)}% free</div>
            </div>
          </>
        ) : (
          <div className="lg:col-span-2">
            <span className="rounded-full border border-amber-700/50 bg-amber-950/20 px-2.5 py-1 text-xs text-amber-200">
              Unavailable
            </span>
            <p className="mt-2 text-sm leading-6 text-neutral-400">
              {disk.message || "Storage details are not available for this path."}
            </p>
          </div>
        )}
      </div>

    </div>
  );
}

function deletedItems(entry) {
  const candidates = [
    entry?.deletedItems,
    entry?.deleted,
    entry?.removedItems,
    entry?.removed,
    entry?.items,
  ];
  return candidates.find(Array.isArray) || [];
}

function deletionCounts(entry) {
  const items = deletedItems(entry);
  const movieItems = items.filter((item) => item.Type === "Movie" || item.type === "Movie");
  const seriesItems = items.filter((item) => item.Type === "Series" || item.type === "Series");
  const movies = Number(entry?.deletedMovies ?? entry?.movieCount ?? movieItems.length ?? 0);
  const series = Number(entry?.deletedSeries ?? entry?.seriesCount ?? seriesItems.length ?? 0);
  return {
    movies,
    series,
    total: Number(entry?.deletedTotal ?? entry?.total ?? movies + series),
  };
}

function deletionMethodLabel(item) {
  const value = item.DeletionMethod || item.deletionMethod || item.Arr || item.arr || "";
  if (!value) return "";
  if (String(value).toLowerCase() === "filesystem") return "Direct file deletion";
  return `Deleted through ${String(value).charAt(0).toUpperCase()}${String(value).slice(1)}`;
}

function isDeletionEntry(entry) {
  if (entry?.dryRun === true) return false;
  return ["deletion", "delete", "cleanup"].includes(entry?.type) ||
    Number(entry?.deletedTotal || entry?.deletedMovies || entry?.deletedSeries) > 0 ||
    deletedItems(entry).length > 0;
}

function DeletedMediaList({ entry }) {
  const items = deletedItems(entry);
  if (!entry) {
    return (
      <p className="mt-3 text-sm text-neutral-400">
        No deletion run has been recorded yet.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="mt-3 text-sm text-neutral-400">
        This deletion run has totals only; item-level deletion history will appear
        here once live deletion records include media details.
      </p>
    );
  }
  return (
    <details className="mt-4 rounded-xl border border-line bg-canvas/60 p-4">
      <summary className="cursor-pointer text-sm font-medium text-neutral-200">
        View media removed during last deletion
      </summary>
      <div className="mt-3 grid gap-2 text-sm">
        {items.map((item) => (
          <div
            key={item.ItemId || item.itemId || `${item.Type || item.type}-${item.Title || item.title}`}
            className="rounded-xl border border-line bg-panel px-3 py-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="min-w-0 break-words font-medium text-accent">
                {item.Title || item.title}
              </span>
              <div className="shrink-0">
                <MediaTypeBadge type={item.Type || item.type || "Media"} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
              {(item.Year || item.year) ? <span>{item.Year || item.year}</span> : null}
              {deletionMethodLabel(item) ? <span>{deletionMethodLabel(item)}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function PendingCountdownBadge({ countdown, mode }) {
  if (!countdown) return null;
  return (
    <div
      className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:gap-2 sm:px-3 sm:text-xs ${countdownTone(
        countdown.DaysRemaining,
        mode,
      )}`}
    >
      <CalendarClock size={14} />
      <CountdownValue countdown={countdown} mode={mode} />
    </div>
  );
}

function PendingDeletionCard({
  item,
  countdown,
  mode,
  busy,
  onRemove,
  onRemoveAndExclude,
}) {
  const title = item?.Title || item?.title || "Untitled media";

  return (
    <article className="flex min-w-0 gap-4 rounded-xl border border-line bg-panel p-5 sm:gap-5">
      <div className="w-28 shrink-0 sm:w-32">
        <MediaPoster
          item={item}
          className="grid h-40 w-28 place-items-center overflow-hidden rounded-xl bg-canvas text-neutral-600 sm:h-48 sm:w-32"
          iconSize={36}
        />
        <MediaMeta
          item={item}
          className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-neutral-400"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <h3 className="line-clamp-2 text-lg font-semibold leading-tight text-accent">
          {title}
        </h3>
        <p className="mt-2 text-sm text-neutral-400">
          Marked {item.MarkedDate || "date unknown"}
        </p>

        <div className="mt-3 space-y-3">
          <QualificationPopover item={item} />
          <PendingCountdownBadge countdown={countdown} mode={mode} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-neutral-300 hover:border-red-900 hover:text-red-300 disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" size={14} />
            ) : (
              <Trash2 size={14} />
            )}
            Remove
          </button>
          <button
            type="button"
            onClick={onRemoveAndExclude}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-neutral-300 hover:border-yellow-700 hover:text-accent disabled:opacity-50"
          >
            <ShieldPlus size={14} />
            Remove + exclude
          </button>
        </div>
      </div>
    </article>
  );
}

function PendingCountdownPanel({ summary, scheduler }) {
  const [now, setNow] = useState(() => new Date());
  const pendingTotal = Number(summary?.pendingTotal || 0);
  const nextEligible = summary?.nextEligible || null;
  const nextDeletionTarget = nextEligible
    ? deletionDateTimeFromEligibleDate(nextEligible.date, scheduler)
    : null;
  const mode = summary?.mode || "live";
  const preview = mode === "preview";
  const scheduled = scheduler?.enabled === true;
  const tone = countdownPanelTone(nextEligible?.daysRemaining, mode);
  const hasPending = pendingTotal > 0 && Boolean(nextEligible);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (preview || !scheduled) return null;

  let detail = "Scrubarr will show the next deletion window once items are pending.";

  if (pendingTotal > 0 && nextEligible) {
    detail = scheduled
      ? "Review or exclude pending items before the next live run deletes media."
      : "Scheduled runs are disabled, so no automatic cleanup run is currently planned.";
    if (preview) {
      detail = "Preview only mode is enabled, so this countdown is advisory and media will not be deleted.";
    }
  }

  return (
    <div
      className={`mt-4 w-full rounded-xl border p-4 ${
        hasPending ? "shadow-[0_0_28px_rgba(250,204,21,0.22)] ring-1 ring-accent/30" : ""
      } ${tone}`}
    >
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 shrink-0 text-accent" size={20} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-neutral-100">Deletion countdown</h3>
          <p className="mt-1 text-sm leading-6 text-neutral-400">{detail}</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-panel/70 p-3">
              <div className="text-xs text-neutral-400">Next deletion</div>
              <div className="mt-2 text-lg font-semibold leading-snug tracking-tight text-neutral-100">
                {nextEligible
                  ? formatNextDeletion(nextEligible.date, scheduler, now)
                  : "None pending"}
              </div>
            </div>
            <div className="rounded-lg bg-panel/70 p-3">
              <div className="text-xs text-neutral-400">Time until deletion occurs</div>
              <div className="mt-2 text-neutral-200">
                {nextEligible ? (
                  <LiveCountdown
                    targetDate={nextDeletionTarget}
                    now={now}
                    mode={mode}
                  />
                ) : (
                  "No pending items"
                )}
              </div>
            </div>
            <div className="rounded-lg bg-panel/70 p-3">
              <div className="text-xs text-neutral-400">Number of items to delete</div>
              <div className="mt-2 text-2xl font-semibold leading-snug tracking-tight text-neutral-100">
                {nextEligible?.count || 0}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [pending, setPending] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [status, setStatus] = useState(null);
  const [pendingSummary, setPendingSummary] = useState(null);
  const [pendingIntegrity, setPendingIntegrity] = useState(null);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [dashboardStatsError, setDashboardStatsError] = useState("");
  const [runLog, setRunLog] = useState([]);
  const [error, setError] = useState("");
  const [queueState, setQueueState] = useState({
    state: "idle",
    message: "",
  });
  const [pendingBusy, setPendingBusy] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState(null);

  async function loadDashboardData() {
    try {
      const [
        pendingItems,
        pendingSummaryResult,
        excludedItems,
        runtimeStatus,
        logs,
        statsResult,
      ] = await Promise.all([
        requestJson("/api/pending"),
        requestJson("/api/pending/summary"),
        requestJson("/api/exclusions"),
        requestJson("/api/health/status"),
        requestJson("/api/logs?limit=200"),
        requestJson("/api/dashboard/stats").then(
          (value) => ({ ok: true, value }),
          (requestError) => ({ ok: false, message: requestError.message }),
        ),
      ]);
      setPending(pendingItems);
      setPendingSummary(pendingSummaryResult);
      setExclusions(excludedItems);
      setStatus(runtimeStatus);
      setRunLog(logs.entries || []);
      if (statsResult.ok) {
        setDashboardStats(statsResult.value);
        setDashboardStatsError("");
      } else {
        setDashboardStats(null);
        setDashboardStatsError(statsResult.message);
      }
      setError("");
      setPendingIntegrity(null);
      requestJson("/api/pending/integrity").then(
        setPendingIntegrity,
        () => setPendingIntegrity(null),
      );
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadDashboardData();
    window.addEventListener("scrubarr:data-changed", loadDashboardData);
    return () =>
      window.removeEventListener("scrubarr:data-changed", loadDashboardData);
  }, []);

  const counts = useMemo(
    () => ({
      movies: pending.filter((item) => item.Type === "Movie").length,
      series: pending.filter((item) => item.Type === "Series").length,
    }),
    [pending],
  );

  const deletionEntries = useMemo(
    () => runLog.filter((entry) => entry.status !== "failed" && isDeletionEntry(entry)),
    [runLog],
  );
  const lastDeletion = deletionEntries[0] || null;
  const lastDeletionCounts = deletionCounts(lastDeletion);
  const runLogDeletionCounts = useMemo(
    () =>
      deletionEntries.reduce(
        (totals, entry) => {
          const entryCounts = deletionCounts(entry);
          return {
            movies: totals.movies + entryCounts.movies,
            series: totals.series + entryCounts.series,
            total: totals.total + entryCounts.total,
          };
        },
        { movies: 0, series: 0, total: 0 },
      ),
    [deletionEntries],
  );
  const persistentDeletionCounts = dashboardStats?.deletions?.allTime;
  const allTimeDeletionCounts = persistentDeletionCounts || runLogDeletionCounts;
  const countdownById = useMemo(() => {
    const entries = Array.isArray(pendingSummary?.items) ? pendingSummary.items : [];
    return new Map(entries.map((item) => [String(item.ItemId), item]));
  }, [pendingSummary]);
  const mediaServer = mediaServerFromStatus(status);
  const mediaServerLocked = mediaServer.selected;
  const mediaServerConfigured = mediaServer.configured;
  const mediaServerLabel =
    mediaServer.selected ? mediaServer.label : dashboardStats?.mediaServer?.label || "Media server";
  const showMediaServerSetup = status && !mediaServerConfigured;
  const mediaServerSetupMessage = mediaServerLocked
    ? `Finish ${mediaServerLabel} setup. Add the ${mediaServerLabel} server URL, API information, libraries, and users before Scrubarr can scan or manage media.`
    : "Set up a media server first. Choose Emby or Jellyfin in Settings before Scrubarr can scan or manage media.";

  async function removePending(item, exclude = false) {
    setPendingConfirm(null);
    setPendingBusy(item.ItemId);
    try {
      await requestJson(
        exclude
          ? `/api/pending/${encodeURIComponent(item.ItemId)}/exclude`
          : `/api/pending/${encodeURIComponent(item.ItemId)}`,
        { method: exclude ? "POST" : "DELETE" },
      );
      await loadDashboardData();
      setQueueState({
        state: "success",
        message: exclude
          ? `${item.Title} was removed from pending and added to exclusions.`
          : `${item.Title} was removed from the pending queue.`,
      });
    } catch (requestError) {
      setQueueState({ state: "error", message: requestError.message });
    } finally {
      setPendingBusy("");
    }
  }

  return (
    <div className="space-y-8">
      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        icon={pendingConfirm?.exclude ? <ShieldPlus size={22} /> : <Trash2 size={22} />}
        title={pendingConfirm?.exclude ? "Remove and exclude?" : "Remove from pending?"}
        message={
          pendingConfirm?.exclude
            ? "Scrubarr will remove this item from the pending queue and add it to exclusions."
            : "Scrubarr will remove this item from the pending queue. It may appear again in a future scan if it still matches the cleanup rules."
        }
        tone={pendingConfirm?.exclude ? "accent" : "danger"}
        confirmLabel={pendingConfirm?.exclude ? "Remove + exclude" : "Remove"}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => removePending(pendingConfirm.item, pendingConfirm.exclude)}
        detail={<ConfirmMediaDetail item={pendingConfirm?.item} />}
      />

      <section>
        <p className="text-sm font-medium text-accent">Overview</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-neutral-400">
          See what Scrubarr is tracking, review pending media, and check the
          next scheduled cleanup.
        </p>
      </section>

      {error && <StatePanel tone="error">{error}</StatePanel>}
      {queueState.message && (
        <StatePanel tone={queueState.state === "error" ? "error" : "neutral"}>
          {queueState.message}
        </StatePanel>
      )}
      {(showMediaServerSetup ||
        status?.updates?.updateAvailable ||
        pendingIntegrity?.staleCount > 0 ||
        status?.capabilities?.debugLogging) && (
        <div className="space-y-3">
          {showMediaServerSetup && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 shrink-0" size={18} />
                <span>{mediaServerSetupMessage}</span>
              </div>
              <a
                href="/settings"
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-amber-300"
              >
                Open settings
              </a>
            </div>
          )}
          {status?.updates?.updateAvailable && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 shrink-0" size={18} />
                <span>New update available.</span>
              </div>
              <a
                href="/settings#updates"
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-amber-300"
              >
                View update
              </a>
            </div>
          )}
          {pendingIntegrity?.staleCount > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CircleAlert className="mt-0.5 shrink-0" size={18} />
                <span>
                  {pendingIntegrity.staleCount} pending{" "}
                  {pendingIntegrity.staleCount === 1 ? "item needs" : "items need"}{" "}
                  review.
                </span>
              </div>
              <a
                href="/safety#pending-integrity"
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-accent/70 bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 transition hover:bg-amber-300"
              >
                Review on Safety
              </a>
            </div>
          )}
          {status?.capabilities?.debugLogging && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 text-sm leading-6 text-amber-100">
              <CircleAlert className="mt-0.5 shrink-0" size={18} />
              <span>
                Debug logging is turned on for troubleshooting logs. Please disable it
                in Settings when no longer required.
              </span>
            </div>
          )}
        </div>
      )}
      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="text-accent" size={21} />
            <h2 className="text-xl font-semibold">Library status</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            Current queue and protection totals
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Pending items" value={pending.length} />
          <Stat label="Pending movies" value={counts.movies} />
          <Stat label="Pending series" value={counts.series} />
          <Stat label="Exclusions" value={exclusions.length} />
        </div>

        <div className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <History className="text-accent" size={20} />
            <h3 className="text-lg font-semibold">Scrubarr activity</h3>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            Last run, next run, deletion countdown, and deletion totals.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Stat
              label="Last run"
              value={formatDate(status?.scheduler?.lastRun?.completedAt, status?.timezone)}
              compact
            />
            <Stat
              label="Next run"
              value={formatDate(status?.scheduler?.nextRun, status?.timezone)}
              compact
            />
          </div>

          <PendingCountdownPanel
            summary={pendingSummary}
            scheduler={status?.scheduler}
        />

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                <CalendarClock size={16} className="text-accent" />
                Media removed during last deletion
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{lastDeletionCounts.movies}</div>
                  <div className="mt-1 text-xs text-neutral-400">Movies</div>
                </div>
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{lastDeletionCounts.series}</div>
                  <div className="mt-1 text-xs text-neutral-400">Series</div>
                </div>
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{lastDeletionCounts.total}</div>
                  <div className="mt-1 text-xs text-neutral-400">Total</div>
                </div>
              </div>
              <DeletedMediaList entry={lastDeletion} />
            </div>

            <div className="rounded-xl border border-line bg-canvas/60 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                <Globe2 size={16} className="text-accent" />
                All-time Scrubarr deletions
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{allTimeDeletionCounts.movies}</div>
                  <div className="mt-1 text-xs text-neutral-400">Movies</div>
                </div>
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{allTimeDeletionCounts.series}</div>
                  <div className="mt-1 text-xs text-neutral-400">Series</div>
                </div>
                <div className="rounded-lg bg-panel p-3">
                  <div className="text-2xl font-semibold">{allTimeDeletionCounts.total}</div>
                  <div className="mt-1 text-xs text-neutral-400">Total</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {mediaServerLocked && (
        <div className="rounded-xl border border-line bg-panel p-5">
          <div className="flex items-center gap-2">
            <Server className="text-accent" size={20} />
            <h3 className="text-lg font-semibold">{mediaServerLabel} library totals</h3>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            Total configured media currently reported by {mediaServerLabel}.
          </p>
          {!mediaServerConfigured ? (
            <StatePanel>
              Finish {mediaServerLabel} setup to see library totals.
            </StatePanel>
          ) : dashboardStatsError ? (
            <StatePanel tone="error">{dashboardStatsError}</StatePanel>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <LibraryTotalCard
                type="Movie"
                badgeLabel="Movies"
                label="Movie titles"
                value={dashboardStats?.media?.movies ?? "..."}
              />
              <LibraryTotalCard
                type="Series"
                label="Series titles"
                value={dashboardStats?.media?.series ?? "..."}
                className="md:col-span-2"
                secondary={{
                  type: "Episode",
                  badgeLabel: "Episodes",
                  label: "Episodes",
                  value: dashboardStats?.media?.episodes ?? "...",
                }}
              />
              <LibraryTotalCard
                type="Total"
                label="Total titles"
                value={dashboardStats?.media?.total ?? "..."}
              />
            </div>
          )}
        </div>
        )}

        {dashboardStats?.storageEnabled && (
          <div className="rounded-xl border border-line bg-panel p-5">
            <div className="flex items-center gap-2">
              <HardDrive className="text-accent" size={20} />
              <h3 className="text-lg font-semibold">Server storage space</h3>
            </div>
            <p className="mt-1 text-sm text-neutral-400">
              Media drives reported by Radarr/Sonarr and matched to {mediaServerLabel} library
              paths.
            </p>
            {dashboardStatsError ? (
              <StatePanel tone="error">{dashboardStatsError}</StatePanel>
            ) : (
              <>
                {dashboardStats?.storageWarnings?.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-100">
                    {dashboardStats.storageWarnings.join(" ")}
                  </div>
                )}
                {dashboardStats?.storage?.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {dashboardStats.storage.map((disk) => (
                      <StorageDisk key={disk.root} disk={disk} />
                    ))}
                  </div>
                ) : (
                  <StatePanel>
                    No Arr storage paths match the media paths reported by {mediaServerLabel} yet.
                  </StatePanel>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardList className="text-accent" size={21} />
              <h2 className="text-xl font-semibold">Pending deletions</h2>
            </div>
            <p className="text-sm text-neutral-400">
              Remove items or protect them with an exclusion
            </p>
          </div>
        </div>

        {pending.length === 0 ? (
          <StatePanel>
            Nothing is currently waiting for deletion.
          </StatePanel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((item) => (
              <PendingDeletionCard
                key={item.ItemId || `${item.Type}-${item.Title}`}
                item={item}
                countdown={countdownById.get(String(item.ItemId))}
                mode={pendingSummary?.mode}
                busy={pendingBusy === item.ItemId}
                onRemove={() => setPendingConfirm({ item, exclude: false })}
                onRemoveAndExclude={() => setPendingConfirm({ item, exclude: true })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
