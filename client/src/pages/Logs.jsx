import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import MediaTypeBadge from "../components/MediaTypeBadge.jsx";
import StatePanel from "../components/StatePanel.jsx";
import { requestJson } from "../lib/api.js";

function displayDate(value) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function duration(entry) {
  if (!entry.startedAt || !entry.completedAt) return "";
  const seconds = Math.max(
    0,
    Math.round((new Date(entry.completedAt) - new Date(entry.startedAt)) / 1000),
  );
  return `${seconds}s`;
}

function fileNameFromDisposition(disposition, fallback) {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-canvas/70 px-3 py-2">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function skippedSummary(skipped = {}) {
  return Object.entries(skipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason.replaceAll("-", " ")}: ${count}`);
}

function isDeletionEntry(entry) {
  return ["deletion", "delete", "cleanup"].includes(entry?.type) ||
    Number(entry?.expiredTotal || entry?.deletedTotal || entry?.failedTotal) > 0;
}

function runTitle(entry) {
  if (isDeletionEntry(entry)) {
    return entry.source === "scheduler" ? "Scheduled deletion check" : "Deletion check";
  }
  if (entry.source === "scheduler" && ["scan", "preview"].includes(entry.type)) {
    return "Scheduled scan";
  }
  if (entry.type === "preview") {
    return "Preview scan";
  }
  if (entry.type === "scan") {
    return "Scan";
  }
  const source = entry.source || "Scrubarr";
  const type = entry.type || "run";
  return `${source} ${type}`.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modeLabel(entry) {
  if (isDeletionEntry(entry)) return entry.dryRun ? "Preview only mode" : "Live mode";
  if (entry.cleanup) return entry.cleanup.dryRun ? "Preview only mode" : "Live mode";
  if (entry.readOnly) return "Preview only mode";
  return "";
}

function statusLabel(status) {
  const value = String(status || "success");
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function statusTone(status) {
  if (status === "failed") return "bg-red-950/40 text-red-300";
  if (status === "partial") return "bg-amber-950/40 text-amber-200";
  return "bg-emerald-950/40 text-emerald-300";
}

function deletionCounts(entry) {
  const deletedItems = Array.isArray(entry.deletedItems) ? entry.deletedItems : [];
  const expiredItems = Array.isArray(entry.expiredItems) ? entry.expiredItems : [];
  return {
    expired: Number(entry.expiredTotal ?? expiredItems.length ?? 0),
    deleted: Number(entry.deletedTotal ?? deletedItems.length ?? 0),
    failed: Number(entry.failedTotal ?? 0),
    movies: Number(
      entry.deletedMovies ??
      deletedItems.filter((item) => item.Type === "Movie" || item.type === "Movie").length ??
      0,
    ),
    series: Number(
      entry.deletedSeries ??
      deletedItems.filter((item) => item.Type === "Series" || item.type === "Series").length ??
      0,
    ),
  };
}

function ScanStats({ entry }) {
  const queued = Number(entry.queued || 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Scanned" value={entry.scanned || 0} />
      <Stat label="Candidates" value={entry.candidates || 0} />
      <Stat label="Movies" value={entry.candidateMovies || 0} />
      <Stat label="Series" value={entry.candidateSeries || 0} />
      {queued > 0 && <Stat label="Queued" value={queued} />}
    </div>
  );
}

function DeletionStats({ entry }) {
  const counts = deletionCounts(entry);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Stat label="Expired pending" value={counts.expired} />
      <Stat label="Deleted" value={counts.deleted} />
      <Stat label="Failed" value={counts.failed} />
      <Stat label="Movies deleted" value={counts.movies} />
      <Stat label="Series deleted" value={counts.series} />
    </div>
  );
}

function SummaryRow({ label, summary }) {
  if (!summary) return null;
  const details = [];
  const providerLabel = summary.provider || "Media server";
  if ("pending" in summary) details.push(`${summary.pending} pending`);
  if ("refreshed" in summary) details.push(summary.refreshed ? `${providerLabel} refreshed` : "No refresh");
  if ("due" in summary) details.push(`${summary.due} due`);
  if ("sent" in summary) details.push(summary.sent ? "Sent" : "Not sent");
  if ("messageCount" in summary) {
    details.push(`${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"}`);
  }
  if ("expired" in summary) details.push(`${summary.expired} expired`);
  if ("deleted" in summary) details.push(`${summary.deleted} deleted`);
  if ("failed" in summary) details.push(`${summary.failed} failed`);

  return (
    <div className="rounded-lg border border-line bg-canvas/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-200">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(summary.status)}`}>
          {statusLabel(summary.status)}
        </span>
      </div>
      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
          {details.map((detail) => (
            <span key={detail} className="rounded-full bg-white/5 px-2.5 py-1">
              {detail}
            </span>
          ))}
        </div>
      )}
      {summary.message && (
        <p className="mt-2 text-xs leading-5 text-neutral-400">{summary.message}</p>
      )}
    </div>
  );
}

function mediaItems(items) {
  return Array.isArray(items) ? items : [];
}

function mediaTitle(item) {
  return item.Title || item.title || "Unknown title";
}

function mediaType(item) {
  return item.Type || item.type || "Media";
}

function mediaYear(item) {
  return item.Year || item.year || "";
}

function deletionMethod(item) {
  return item.DeletionMethod || item.Method || item.method || "";
}

function failureReason(item) {
  return item.DeleteError || item.Error || item.error || item.Message || item.message || "";
}

function DeletionMediaSection({ title, items, tone = "neutral" }) {
  const list = mediaItems(items);
  if (list.length === 0) return null;
  const titleClass = tone === "danger" ? "text-red-200" : "text-neutral-200";

  return (
    <section>
      <h3 className={`text-sm font-semibold ${titleClass}`}>{title}</h3>
      <div className="mt-2 grid gap-2">
        {list.map((item) => (
          <div
            key={`${mediaType(item)}-${item.ItemId || item.itemId || mediaTitle(item)}`}
            className="rounded-xl border border-line bg-panel px-3 py-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="min-w-0 break-words font-medium text-accent">
                {mediaTitle(item)}
              </span>
              <div className="shrink-0">
                <MediaTypeBadge type={mediaType(item)} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
              {mediaYear(item) ? <span>{mediaYear(item)}</span> : null}
              {deletionMethod(item) ? <span>Deleted through {deletionMethod(item)}</span> : null}
              {failureReason(item) ? <span className="text-red-200">{failureReason(item)}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeletionMediaDetails({ entry }) {
  const deleted = mediaItems(entry.deletedItems);
  const failed = mediaItems(entry.failedItems);
  const expired = entry.dryRun ? mediaItems(entry.expiredItems) : [];
  const total = deleted.length + failed.length + expired.length;
  if (total === 0) return null;

  return (
    <details className="mt-4 rounded-lg border border-line bg-canvas/60 p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        View deletion media details
      </summary>
      <div className="mt-3 space-y-4">
        <DeletionMediaSection title="Deleted media" items={deleted} />
        <DeletionMediaSection title="Failed media" items={failed} tone="danger" />
        <DeletionMediaSection title="Ready in preview mode" items={expired} />
      </div>
    </details>
  );
}

export default function Logs() {
  const [entries, setEntries] = useState([]);
  const [state, setState] = useState({ state: "loading", message: "" });
  const [fileView, setFileView] = useState(null);
  const [fileState, setFileState] = useState({ state: "idle", message: "" });
  const [exportState, setExportState] = useState({ state: "idle", message: "" });
  const [settings, setSettings] = useState(null);
  const [settingsState, setSettingsState] = useState({ state: "idle", message: "" });

  async function load() {
    setState({ state: "loading", message: "Loading logs..." });
    try {
      const data = await requestJson("/api/logs?limit=100");
      setEntries(data.entries || []);
      setState({ state: "idle", message: "" });
    } catch (error) {
      setState({ state: "error", message: error.message });
    }
  }

  async function loadDebugSettings() {
    setSettingsState({ state: "loading", message: "Loading debug setting..." });
    try {
      const data = await requestJson("/api/settings");
      setSettings(data);
      setSettingsState({ state: "idle", message: "" });
    } catch (error) {
      setSettingsState({ state: "error", message: error.message });
    }
  }

  async function toggleFileView(kind) {
    if (fileView?.kind === kind) {
      setFileView(null);
      setFileState({ state: "idle", message: "" });
      return;
    }

    const endpoint = kind === "app" ? "/api/logs/app-file" : "/api/logs/file";
    setFileState({ state: "loading", message: "Loading log file..." });
    try {
      const data = await requestJson(endpoint);
      setFileView({ ...data, kind });
      setFileState({ state: "idle", message: "" });
    } catch (error) {
      setFileState({ state: "error", message: error.message });
    }
  }

  async function exportLogs() {
    setExportState({ state: "loading", message: "" });
    try {
      const response = await fetch("/api/logs/export");
      if (!response.ok) {
        throw new Error(`Export failed with ${response.status}`);
      }
      const blob = await response.blob();
      const fileName = fileNameFromDisposition(
        response.headers.get("content-disposition"),
        "Scrubarr-logs.zip",
      );
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportState({ state: "success", message: `${fileName} exported.` });
    } catch (error) {
      setExportState({ state: "error", message: error.message });
    }
  }

  async function setDebugLogging(enabled) {
    if (!settings) return;
    const previous = settings;
    const next = {
      ...settings,
      DebugMode: {
        ...(settings.DebugMode || {}),
        Enabled: enabled,
      },
    };
    setSettings(next);
    setSettingsState({
      state: "loading",
      message: enabled ? "Enabling debug logging..." : "Disabling debug logging...",
    });

    try {
      const data = await requestJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setSettings(data.settings || next);
      setSettingsState({ state: "idle", message: "" });
      window.dispatchEvent(new Event("scrubarr:settings-changed"));
    } catch (error) {
      setSettings(previous);
      setSettingsState({ state: "error", message: error.message });
    }
  }

  useEffect(() => {
    load();
    loadDebugSettings();
  }, []);

  const totals = useMemo(
    () => ({
      runs: entries.length,
      failures: entries.filter((entry) => entry.status === "failed").length,
      candidates: entries.reduce(
        (total, entry) => total + (isDeletionEntry(entry) ? 0 : Number(entry.candidates || 0)),
        0,
      ),
      warnings: entries.reduce(
        (total, entry) => total + (entry.warnings?.length || 0),
        0,
      ),
    }),
    [entries],
  );
  const debugEnabled = settings?.DebugMode?.Enabled === true;
  const mediaServerLabel =
    settings?.MediaServer?.Locked === true
      ? settings?.MediaServer?.Provider === "jellyfin"
        ? "Jellyfin"
        : "Emby"
      : "Media server";

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-accent">History</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Logs</h1>
          <p className="mt-2 max-w-3xl text-neutral-400">
            Check recent scan activity, scheduled runs, warnings, and errors in
            one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => toggleFileView("run")}
            disabled={fileState.state === "loading"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            {fileState.state === "loading" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <FileText size={16} />
            )}
            {fileView?.kind === "run" ? "Hide run log file" : "View run log file"}
          </button>
          <button
            type="button"
            onClick={() => toggleFileView("app")}
            disabled={fileState.state === "loading"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            {fileState.state === "loading" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <FileText size={16} />
            )}
            {fileView?.kind === "app" ? "Hide app log" : "View app log"}
          </button>
          <button
            type="button"
            onClick={exportLogs}
            disabled={exportState.state === "loading"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            {exportState.state === "loading" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Download size={16} />
            )}
            Export logs
          </button>
          <button
            type="button"
            onClick={load}
            disabled={state.state === "loading"}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            {state.state === "loading" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            Refresh
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-accent">Logging controls</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Debug logging</h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs ${
                  debugEnabled
                    ? "bg-emerald-950/40 text-emerald-300"
                    : "bg-white/5 text-neutral-400"
                }`}
              >
                {debugEnabled ? "On" : "Off"}
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              Use this only while troubleshooting. It adds more detail to the
              app log and should be switched off again when you are done.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={debugEnabled}
            disabled={!settings || settingsState.state === "loading"}
            onClick={() => setDebugLogging(!debugEnabled)}
            className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              debugEnabled
                ? "border-emerald-700/80 bg-emerald-950/40 text-emerald-200 hover:border-emerald-500"
                : "border-line text-neutral-200 hover:border-neutral-500"
            }`}
          >
            {settingsState.state === "loading" ? (
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="animate-spin" size={16} />
                Updating
              </span>
            ) : debugEnabled ? (
              "Disable debug logging"
            ) : (
              "Enable debug logging"
            )}
          </button>
        </div>
        {debugEnabled && (
          <p className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-sm text-amber-200">
            Debug logging is turned on for troubleshooting logs. Please disable
            it when no longer required.
          </p>
        )}
      </section>

      {state.state === "error" && <StatePanel tone="error">{state.message}</StatePanel>}
      {fileState.state === "error" && (
        <StatePanel tone="error">{fileState.message}</StatePanel>
      )}
      {settingsState.state === "error" && (
        <StatePanel tone="error">{settingsState.message}</StatePanel>
      )}
      {exportState.state === "error" && (
        <StatePanel tone="error">{exportState.message}</StatePanel>
      )}
      {exportState.state === "success" && (
        <StatePanel>{exportState.message}</StatePanel>
      )}

      {fileView && (
        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-accent">
                {fileView.kind === "app" ? "App log" : "Run log file"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <FileText className="text-accent" size={20} />
                <h2 className="text-lg font-semibold">{fileView.fileName}</h2>
              </div>
            </div>
            <span className="text-xs text-neutral-400">
              Stored log file preview
            </span>
          </div>
          <pre className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-line bg-canvas p-4 text-xs leading-relaxed text-neutral-300">
            {fileView.content || "[]"}
          </pre>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Logged runs" value={totals.runs} />
        <Stat label="Failures" value={totals.failures} />
        <Stat label="Candidates seen" value={totals.candidates} />
        <Stat label="Warnings" value={totals.warnings} />
      </div>

      {entries.length === 0 ? (
        <StatePanel>
          No scan history yet. Runs will appear here after Scrubarr checks
          your libraries.
        </StatePanel>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const failed = entry.status === "failed";
            const partial = entry.status === "partial";
            const skipped = skippedSummary(entry.skipped);
            const mode = modeLabel(entry);
            const deletionEntry = isDeletionEntry(entry);
            return (
              <article
                key={entry.id}
                className="rounded-xl border border-line bg-panel p-5"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {failed ? (
                        <AlertTriangle className="text-red-400" size={18} />
                      ) : partial ? (
                        <AlertTriangle className="text-amber-300" size={18} />
                      ) : (
                        <CheckCircle2 className="text-emerald-400" size={18} />
                      )}
                      <h2 className="font-semibold">{runTitle(entry)}</h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${statusTone(entry.status)}`}
                      >
                        {statusLabel(entry.status)}
                      </span>
                      {mode && (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-neutral-400">
                          {mode}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-neutral-400">
                      {displayDate(entry.completedAt)}
                      {duration(entry) ? ` - ${duration(entry)}` : ""}
                    </p>
                  </div>
                  <ClipboardList className="hidden text-neutral-600 md:block" size={22} />
                </div>

                {failed && (
                  <p className="mt-4 rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm text-red-200">
                    {entry.message || "Run failed"}
                  </p>
                )}

                <div className="mt-4">
                  {deletionEntry ? (
                    <DeletionStats entry={entry} />
                  ) : (
                    <ScanStats entry={entry} />
                  )}
                </div>

                {deletionEntry && (
                  <>
                    {(entry.telegram || entry.failureTelegram) && (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <SummaryRow label="Deletion report" summary={entry.telegram} />
                        <SummaryRow label="Failure report" summary={entry.failureTelegram} />
                      </div>
                    )}
                    <DeletionMediaDetails entry={entry} />
                  </>
                )}

                {!deletionEntry &&
                  (entry.librarySync || entry.notifications || entry.cleanup) && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <SummaryRow label={`${mediaServerLabel} library sync`} summary={entry.librarySync} />
                      <SummaryRow label="Telegram notifications" summary={entry.notifications} />
                      <SummaryRow label="Deletion check" summary={entry.cleanup} />
                    </div>
                  )}

                {entry.warnings?.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-sm text-amber-200">
                    <p className="font-medium">Warnings</p>
                    <ul className="mt-2 list-inside list-disc space-y-1">
                      {entry.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {skipped.length > 0 && (
                  <details className="mt-4 rounded-lg border border-line bg-canvas/60 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      Skipped item summary
                    </summary>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400">
                      {skipped.map((item) => (
                        <span key={item} className="rounded-full bg-white/5 px-2.5 py-1">
                          {item}
                        </span>
                      ))}
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
