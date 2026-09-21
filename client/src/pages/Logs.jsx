import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  FileText,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { SelectInput } from "../components/FormControls.jsx";
import MediaTypeBadge from "../components/MediaTypeBadge.jsx";
import RunStatusPill from "../components/RunStatusPill.jsx";
import StatePanel from "../components/StatePanel.jsx";
import { requestJson } from "../lib/api.js";
import { inputClass } from "../lib/formClasses.js";
import {
  browserTimeZone,
  collectRunProblems,
  deletionCounts,
  displayRunDate,
  filterRunEntries,
  getRunOutcome,
  isDeletionRelatedLog,
  paginateRunEntries,
  runDuration,
  runModeLabel,
  runSummary,
  runTitle,
} from "../lib/runPresentation.js";

const RESULT_FILTERS = new Set(["all", "warnings", "problems"]);
const PAGE_SIZES = new Set(["5", "25", "100", "all"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fileNameFromDisposition(disposition, fallback) {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function entryKey(entry, index) {
  return String(entry.id || `legacy-${entry.completedAt || entry.startedAt || "run"}-${index}`);
}

function runElementId(key) {
  return `run-${encodeURIComponent(key)}`;
}

function Stat({ label, value, detail, onClick, active = false }) {
  const content = (
    <>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 font-semibold text-neutral-100">{value}</p>
      {detail && <p className="mt-1 text-xs leading-5 text-neutral-500">{detail}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`min-w-0 px-4 py-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
          active
            ? "bg-canvas/80 shadow-[inset_0_-2px_0_rgba(250,204,21,0.7)]"
            : "bg-panel hover:bg-canvas/70"
        }`}
      >
        {content}
      </button>
    );
  }
  return <div className="min-w-0 bg-panel px-4 py-3">{content}</div>;
}

function DetailStat({ label, value }) {
  return (
    <div className="rounded-lg bg-canvas/70 px-3 py-2">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function skippedSummary(skipped = {}) {
  return Object.entries(skipped)
    .filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${reason.replaceAll("-", " ")}: ${count}`);
}

function stageStatusLabel(status) {
  const value = String(status || "unknown");
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function stageStatusTone(status) {
  if (status === "failed") return "bg-red-950/40 text-red-300";
  if (status === "partial") return "bg-amber-950/40 text-amber-200";
  if (status === "success" || status === "sent") {
    return "bg-emerald-950/40 text-emerald-300";
  }
  return "bg-white/5 text-neutral-400";
}

function ScanStats({ entry }) {
  const queued = Number(entry.queued || 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <DetailStat label="Scanned" value={entry.scanned || 0} />
      <DetailStat label="Candidates" value={entry.candidates || 0} />
      <DetailStat label="Movies" value={entry.candidateMovies || 0} />
      <DetailStat label="Series" value={entry.candidateSeries || 0} />
      {queued > 0 && <DetailStat label="Queued" value={queued} />}
    </div>
  );
}

function DeletionStats({ entry }) {
  const counts = deletionCounts(entry);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <DetailStat label={entry.dryRun ? "Would delete" : "Due"} value={counts.expired} />
      {!entry.dryRun && <DetailStat label="Deleted" value={counts.deleted} />}
      {!entry.dryRun && <DetailStat label="Removed from pending" value={counts.removed} />}
      <DetailStat label="Deferred" value={counts.deferred} />
      <DetailStat label="Failed" value={counts.failed} />
      {!entry.dryRun && <DetailStat label="Movies deleted" value={counts.movies} />}
      {!entry.dryRun && <DetailStat label="Series deleted" value={counts.series} />}
    </div>
  );
}

function SummaryRow({ label, summary }) {
  if (!summary) return null;
  const deliveryFailed = summary.attempted === true && !summary.sent ||
    summary.attempted === undefined && summary.enabled && !summary.sent &&
      /failed|error|forbidden|aborted/i.test(summary.message || "");
  const summaryStatus = summary.status || (summary.sent ? "sent" : deliveryFailed ? "failed" : "skipped");
  const details = [];
  const providerLabel = summary.provider || "Media server";
  if ("pending" in summary) details.push(`${summary.pending} pending`);
  if ("refreshed" in summary) {
    details.push(summary.refreshed ? `${providerLabel} refreshed` : "No refresh");
  }
  if ("due" in summary) details.push(`${summary.due} due`);
  if ("sent" in summary) details.push(summary.sent ? "Sent" : "Not sent");
  if ("messageCount" in summary) {
    details.push(`${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"}`);
  }
  if ("expired" in summary) details.push(`${summary.expired} expired`);
  if ("deleted" in summary) details.push(`${summary.deleted} deleted`);
  if (Number(summary.removed || 0) > 0) {
    details.push(`${summary.removed} removed from pending`);
  }
  if ("failed" in summary) details.push(`${summary.failed} failed`);
  if (Number(summary.deferred || 0) > 0) details.push(`${summary.deferred} deferred`);
  if (Array.isArray(summary.scanWarnings) && summary.scanWarnings.length > 0) {
    details.push(`${summary.scanWarnings.length} warning${summary.scanWarnings.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="rounded-lg border border-line bg-canvas/60 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-200">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${stageStatusTone(summaryStatus)}`}>
          {stageStatusLabel(summaryStatus)}
        </span>
      </div>
      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-400">
          {details.map((detail) => (
            <span key={detail} className="rounded-full bg-white/5 px-2.5 py-1">{detail}</span>
          ))}
        </div>
      )}
      {summary.message && <p className="mt-2 text-xs leading-5 text-neutral-400">{summary.message}</p>}
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

function itemReason(item) {
  return item.SkipMessage || item.DeleteError || item.Error || item.error || item.Message || item.message || "";
}

function DeletionMediaSection({ title, items, tone = "neutral" }) {
  const list = mediaItems(items);
  if (list.length === 0) return null;
  const titleClass = tone === "danger"
    ? "text-red-200"
    : tone === "warning"
      ? "text-amber-200"
      : "text-neutral-200";
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
              <span className="min-w-0 break-words font-medium text-accent">{mediaTitle(item)}</span>
              <div className="shrink-0"><MediaTypeBadge type={mediaType(item)} /></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
              {mediaYear(item) ? <span>{mediaYear(item)}</span> : null}
              {deletionMethod(item) ? <span>Deleted through {deletionMethod(item)}</span> : null}
              {itemReason(item) ? (
                <span className={tone === "danger" ? "text-red-200" : tone === "warning" ? "text-amber-200" : ""}>
                  {itemReason(item)}
                </span>
              ) : null}
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
  const removed = mediaItems(entry.removedItems);
  const deferred = mediaItems(entry.deferredItems);
  const expired = entry.dryRun ? mediaItems(entry.expiredItems) : [];
  if (deleted.length + failed.length + removed.length + deferred.length + expired.length === 0) {
    return null;
  }
  return (
    <div className="space-y-4">
      <DeletionMediaSection title="Removed from pending" items={removed} tone="warning" />
      <DeletionMediaSection title="Deferred media" items={deferred} tone="warning" />
      <DeletionMediaSection title="Failed media" items={failed} tone="danger" />
      <DeletionMediaSection title="Deleted media" items={deleted} />
      <DeletionMediaSection title="Ready in preview mode" items={expired} />
    </div>
  );
}

function OutcomeIcon({ outcome }) {
  if (outcome.key === "failed") return <AlertTriangle className="text-red-400" size={18} />;
  if (["warning", "partial"].includes(outcome.key)) {
    return <AlertTriangle className="text-amber-300" size={18} />;
  }
  if (["completed", "protected"].includes(outcome.key)) {
    return <CheckCircle2 className="text-emerald-400" size={18} />;
  }
  return <ClipboardList className="text-neutral-500" size={18} />;
}

function RunDetails({ entry, mediaServerLabel }) {
  const problems = collectRunProblems(entry);
  const skipped = skippedSummary(entry.skipped);
  const deletionEntry = isDeletionRelatedLog(entry);
  const outcome = getRunOutcome(entry);
  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      {outcome.key === "failed" && (
        <StatePanel tone="error">{entry.message || "Run failed."}</StatePanel>
      )}
      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-sm text-amber-100">
          <p className="font-medium">Problems recorded</p>
          <ul className="mt-2 space-y-1 leading-6 text-amber-100/85">
            {problems.map((problem) => (
              <li key={problem} className="flex gap-2">
                <span className="text-amber-300">-</span><span>{problem}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {deletionEntry ? <DeletionStats entry={entry} /> : <ScanStats entry={entry} />}
      {deletionEntry && <DeletionMediaDetails entry={entry} />}
      {deletionEntry && (entry.telegram || entry.removalTelegram || entry.deferralTelegram || entry.failureTelegram) && (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <SummaryRow label="Deletion report" summary={entry.telegram} />
          <SummaryRow label="Pending queue update" summary={entry.removalTelegram} />
          <SummaryRow label="Safety deferral report" summary={entry.deferralTelegram} />
          <SummaryRow label="Failure report" summary={entry.failureTelegram} />
        </div>
      )}
      {!deletionEntry && (entry.librarySync || entry.notifications || entry.cleanup) && (
        <div className="grid gap-3 lg:grid-cols-3">
          <SummaryRow label={`${mediaServerLabel} library sync`} summary={entry.librarySync} />
          <SummaryRow label="Telegram notifications" summary={entry.notifications} />
          <SummaryRow label="Deletion check" summary={entry.cleanup} />
        </div>
      )}
      {skipped.length > 0 && (
        <div className="rounded-lg border border-line bg-canvas/60 p-3 text-sm">
          <p className="font-medium">Skipped item summary</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400">
            {skipped.map((item) => (
              <span key={item} className="rounded-full bg-white/5 px-2.5 py-1">{item}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState({ hasLoaded: false, refreshing: false, message: "" });
  const [fileView, setFileView] = useState(null);
  const [fileState, setFileState] = useState({ state: "idle", message: "" });
  const [exportState, setExportState] = useState({ state: "idle", message: "" });
  const [settings, setSettings] = useState(null);
  const [settingsState, setSettingsState] = useState({ state: "idle", message: "" });
  const [expanded, setExpanded] = useState(() => new Set());
  const [dateDraft, setDateDraft] = useState({
    from: searchParams.get("from") || "",
    to: searchParams.get("to") || "",
  });
  const [dateError, setDateError] = useState("");
  const [dateFilterOpen, setDateFilterOpen] = useState(() =>
    Boolean(searchParams.get("from") || searchParams.get("to")),
  );
  const [historyFocusRequest, setHistoryFocusRequest] = useState(0);
  const [runLookupMessage, setRunLookupMessage] = useState("");
  const requestGeneration = useRef(0);
  const handledRun = useRef("");
  const focusTarget = useRef("");
  const focusPageHeading = useRef(false);

  const resultFilter = RESULT_FILTERS.has(searchParams.get("result"))
    ? searchParams.get("result")
    : "all";
  const sizeValue = PAGE_SIZES.has(searchParams.get("size"))
    ? searchParams.get("size")
    : "5";
  const requestedPage = Math.max(
    1,
    Number.parseInt(searchParams.get("page") || "1", 10) || 1,
  );
  const appliedFrom = DATE_PATTERN.test(searchParams.get("from") || "")
    ? searchParams.get("from")
    : "";
  const appliedTo = DATE_PATTERN.test(searchParams.get("to") || "")
    ? searchParams.get("to")
    : "";
  const requestedRun = searchParams.get("run") || "";
  const timeZone = browserTimeZone();

  const updateQuery = useCallback((values, options = {}) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(values).forEach(([key, value]) => {
      const isDefault =
        (key === "result" && value === "all") ||
        (key === "size" && value === "5") ||
        (key === "page" && value === 1);
      if (value === null || value === undefined || value === "" || isDefault) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    setSearchParams(next, { replace: options.replace === true });
  }, [searchParams, setSearchParams]);

  async function load() {
    const generation = ++requestGeneration.current;
    setLoadState((current) => ({ ...current, refreshing: current.hasLoaded, message: "" }));
    try {
      const data = await requestJson("/api/logs?limit=200");
      if (generation !== requestGeneration.current) return;
      const nextEntries = Array.isArray(data.entries) ? data.entries : [];
      setEntries(nextEntries);
      setExpanded((current) => new Set(
        [...current].filter((id) =>
          nextEntries.some((entry, index) => entryKey(entry, index) === id),
        ),
      ));
      setLoadState({ hasLoaded: true, refreshing: false, message: "" });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setLoadState((current) => ({
        ...current,
        refreshing: false,
        message: error.message,
      }));
    }
  }

  async function loadSupportingData() {
    setSettingsState({ state: "loading", message: "" });
    try {
      const nextSettings = await requestJson("/api/settings");
      setSettings(nextSettings);
      setSettingsState({ state: "idle", message: "" });
    } catch (error) {
      setSettingsState({ state: "error", message: error.message });
    }
  }

  useEffect(() => {
    load();
    loadSupportingData();
  }, []);

  useEffect(() => {
    setDateDraft({ from: appliedFrom, to: appliedTo });
  }, [appliedFrom, appliedTo]);

  useEffect(() => {
    if (!requestedRun) handledRun.current = "";
  }, [requestedRun]);

  const dateFilteredEntries = useMemo(
    () => filterRunEntries(entries, { from: appliedFrom, to: appliedTo, timeZone }),
    [entries, appliedFrom, appliedTo, timeZone],
  );
  const filteredEntries = useMemo(
    () => filterRunEntries(dateFilteredEntries, { result: resultFilter, timeZone }),
    [dateFilteredEntries, resultFilter, timeZone],
  );
  const pagination = paginateRunEntries(filteredEntries, sizeValue, requestedPage);
  const {
    page: currentPage,
    totalPages,
    startIndex,
    entries: pageEntries,
  } = pagination;

  useEffect(() => {
    if (loadState.hasLoaded && requestedPage !== currentPage) {
      updateQuery({ page: currentPage }, { replace: true });
    }
  }, [currentPage, loadState.hasLoaded, requestedPage, updateQuery]);

  useEffect(() => {
    if (!loadState.hasLoaded || !requestedRun || handledRun.current === requestedRun) return;
    const target = entries.find((entry) => String(entry.id || "") === requestedRun);
    handledRun.current = requestedRun;
    if (!target) {
      setRunLookupMessage("This run could not be found in retained history.");
      return;
    }
    setRunLookupMessage("");
    const currentMatch = filteredEntries.findIndex((entry) => entry === target);
    const needsClear = currentMatch < 0;
    const targetList = needsClear ? entries : filteredEntries;
    const targetIndex = targetList.findIndex((entry) => entry === target);
    const targetPage = sizeValue === "all"
      ? 1
      : Math.floor(targetIndex / Number(sizeValue)) + 1;
    setExpanded((current) => new Set(current).add(requestedRun));
    focusTarget.current = requestedRun;
    updateQuery({
      result: needsClear ? "all" : resultFilter,
      from: needsClear ? null : appliedFrom,
      to: needsClear ? null : appliedTo,
      page: targetPage,
    }, { replace: true });
  }, [
    appliedFrom,
    appliedTo,
    entries,
    filteredEntries,
    loadState.hasLoaded,
    requestedRun,
    resultFilter,
    sizeValue,
    updateQuery,
  ]);

  useEffect(() => {
    const target = focusTarget.current;
    if (!target || !pageEntries.some((entry) => String(entry.id || "") === target)) return;
    focusTarget.current = "";
    window.requestAnimationFrame(() => {
      const element = document.getElementById(runElementId(target));
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    });
  }, [pageEntries, expanded]);

  useEffect(() => {
    if (!focusPageHeading.current || historyFocusRequest === 0) return;
    focusPageHeading.current = false;
    window.requestAnimationFrame(() => {
      const heading = document.getElementById("run-history-heading");
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading?.focus({ preventScroll: true });
    });
  }, [historyFocusRequest]);

  const totals = useMemo(() => {
    const outcomes = dateFilteredEntries.map(getRunOutcome);
    const warningCounts = dateFilteredEntries.map((entry) => collectRunProblems(entry).length);
    return {
      runs: dateFilteredEntries.length,
      failed: outcomes.filter((outcome) => outcome.key === "failed").length,
      partial: outcomes.filter((outcome) => outcome.key === "partial").length,
      candidates: dateFilteredEntries.reduce(
        (total, entry) => total + (isDeletionRelatedLog(entry) ? 0 : Number(entry.candidates || 0)),
        0,
      ),
      warnings: warningCounts.reduce((total, count) => total + count, 0),
      warningRuns: warningCounts.filter((count) => count > 0).length,
    };
  }, [dateFilteredEntries]);

  const debugEnabled = settings?.DebugMode?.Enabled === true;
  const mediaServerLabel = settings?.MediaServer?.Locked === true
    ? settings?.MediaServer?.Provider === "jellyfin" ? "Jellyfin" : "Emby"
    : "Media server";

  function changeResult(result) {
    handledRun.current = "";
    focusPageHeading.current = true;
    setHistoryFocusRequest((request) => request + 1);
    updateQuery({ result, page: 1, run: null });
  }

  function applyDateRange() {
    if (
      (dateDraft.from && !DATE_PATTERN.test(dateDraft.from)) ||
      (dateDraft.to && !DATE_PATTERN.test(dateDraft.to))
    ) {
      setDateError("Enter valid From and To dates.");
      return;
    }
    if (dateDraft.from && dateDraft.to && dateDraft.from > dateDraft.to) {
      setDateError("From date must be on or before To date.");
      return;
    }
    setDateError("");
    handledRun.current = "";
    focusPageHeading.current = true;
    setHistoryFocusRequest((request) => request + 1);
    setDateFilterOpen(false);
    updateQuery({ from: dateDraft.from, to: dateDraft.to, page: 1, run: null });
  }

  function clearFilters() {
    setDateDraft({ from: "", to: "" });
    setDateError("");
    handledRun.current = "";
    setSearchParams(new URLSearchParams());
  }

  function changePage(page) {
    focusPageHeading.current = true;
    setHistoryFocusRequest((request) => request + 1);
    updateQuery({ page, run: null });
  }

  function toggleEntry(key) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function toggleFileView(kind) {
    if (fileView?.kind === kind) {
      setFileView(null);
      setFileState({ state: "idle", message: "" });
      return;
    }
    const endpoint = kind === "app" ? "/api/logs/app-file" : "/api/logs/file";
    setFileState({ state: "loading", message: "" });
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
      if (!response.ok) throw new Error(`Export failed with ${response.status}`);
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
      DebugMode: { ...(settings.DebugMode || {}), Enabled: enabled },
    };
    setSettings(next);
    setSettingsState({ state: "loading", message: "" });
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

  const shownStart = filteredEntries.length === 0 ? 0 : startIndex + 1;
  const shownEnd = Math.min(startIndex + pageEntries.length, filteredEntries.length);
  const dateDescription = appliedFrom || appliedTo
    ? `${appliedFrom || "earliest retained"} to ${appliedTo || "latest retained"}`
    : "all retained dates";

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-accent">History</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Logs</h1>
          <p className="mt-2 max-w-3xl text-neutral-400">
            Review recent runs and find warnings or failures without opening every record.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl border border-line bg-panel/70 p-2">
          <button type="button" onClick={() => toggleFileView("run")} disabled={fileState.state === "loading"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200 disabled:opacity-60">
            {fileState.state === "loading" ? <LoaderCircle className="animate-spin" size={16} /> : <FileText size={16} />}
            {fileView?.kind === "run" ? "Hide run log" : "View run log"}
          </button>
          <button type="button" onClick={() => toggleFileView("app")} disabled={fileState.state === "loading"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200 disabled:opacity-60">
            <FileText size={16} /> {fileView?.kind === "app" ? "Hide app log" : "View app log"}
          </button>
          <button type="button" onClick={exportLogs} disabled={exportState.state === "loading"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60">
            {exportState.state === "loading" ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />} Export logs
          </button>
          <button type="button" onClick={load} disabled={loadState.refreshing || !loadState.hasLoaded} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200 disabled:opacity-60">
            {loadState.refreshing ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />} Refresh
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
              Use this only while troubleshooting. It adds more detail to the app log and
              should be switched off again when you are done.
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
            Debug logging is turned on. Disable it when troubleshooting is complete.
          </p>
        )}
      </section>

      {loadState.message && (
        <StatePanel tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadState.message}</span>
            <button type="button" onClick={load} className="rounded-lg border border-red-700 px-3 py-1.5 text-sm">Try again</button>
          </div>
        </StatePanel>
      )}
      {runLookupMessage && <StatePanel tone="warning">{runLookupMessage}</StatePanel>}
      {fileState.state === "error" && <StatePanel tone="error">{fileState.message}</StatePanel>}
      {settingsState.state === "error" && (
        <StatePanel tone="error">Debug setting unavailable: {settingsState.message}</StatePanel>
      )}
      {exportState.state === "error" && <StatePanel tone="error">{exportState.message}</StatePanel>}
      {exportState.state === "success" && <StatePanel>{exportState.message}</StatePanel>}

      {fileView && (
        <section className="rounded-xl border border-line bg-panel p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-accent">{fileView.kind === "app" ? "App log" : "Run log file"}</p>
              <h2 className="mt-1 text-lg font-semibold">{fileView.fileName}</h2>
            </div>
            <span className="text-xs text-neutral-400">Stored log file preview</span>
          </div>
          <pre className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-line bg-canvas p-4 text-xs leading-relaxed text-neutral-300">{fileView.content || "[]"}</pre>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-line">
        <div className="border-b border-line bg-panel px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent/90">Recent activity</p>
          <p className="mt-1 text-sm text-neutral-400">
            Counts cover {dateDescription} in retained history, before status and page filters.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line lg:grid-cols-4">
          <Stat label="Failed / partial" value={totals.failed + totals.partial} detail={`${totals.failed} failed, ${totals.partial} partial`} onClick={() => changeResult("problems")} active={resultFilter === "problems"} />
          <Stat label="Warnings" value={totals.warnings} detail={`${totals.warningRuns} affected ${totals.warningRuns === 1 ? "entry" : "entries"}`} onClick={() => changeResult("warnings")} active={resultFilter === "warnings"} />
          <Stat label="Logged entries" value={totals.runs} detail="Show all outcomes" onClick={() => changeResult("all")} active={resultFilter === "all"} />
          <Stat label="Candidates seen" value={totals.candidates} />
        </div>
      </section>

      <section className="relative z-10 overflow-visible rounded-xl border border-line bg-panel p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_12rem]">
          <label>
            <span className="text-sm font-medium text-neutral-200">Show</span>
            <SelectInput value={resultFilter} onChange={changeResult}>
              <option value="all">All entries</option>
              <option value="warnings">With warnings</option>
              <option value="problems">Failed or partial</option>
            </SelectInput>
          </label>
          <label>
            <span className="text-sm font-medium text-neutral-200">Entries per page</span>
            <SelectInput value={sizeValue} onChange={(value) => updateQuery({ size: value, page: 1, run: null })}>
              <option value="5">5</option>
              <option value="25">25</option>
              <option value="100">100</option>
              <option value="all">All retained</option>
            </SelectInput>
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-canvas/50 p-3">
          <button
            type="button"
            aria-expanded={dateFilterOpen}
            aria-controls="log-date-filter-fields"
            onClick={() => setDateFilterOpen((open) => !open)}
            className="flex min-h-10 w-full items-center justify-between gap-3 text-left text-sm font-medium"
          >
            <span className="inline-flex items-center gap-2">
              <CalendarRange size={17} className="text-accent" />
              {dateFilterOpen ? "Hide date filter" : "Filter by date"}
            </span>
            {dateFilterOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </button>
          {dateFilterOpen && (
            <div id="log-date-filter-fields">
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                <label>
                  <span className="text-sm text-neutral-300">From</span>
                  <input type="date" className={inputClass} value={dateDraft.from} onChange={(event) => setDateDraft((current) => ({ ...current, from: event.target.value }))} />
                </label>
                <label>
                  <span className="text-sm text-neutral-300">To</span>
                  <input type="date" className={inputClass} value={dateDraft.to} onChange={(event) => setDateDraft((current) => ({ ...current, to: event.target.value }))} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={applyDateRange} className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-neutral-950">Apply</button>
                  <button type="button" onClick={() => { setDateDraft({ from: "", to: "" }); setDateError(""); setDateFilterOpen(false); focusPageHeading.current = true; setHistoryFocusRequest((request) => request + 1); updateQuery({ from: null, to: null, page: 1, run: null }); }} className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm">Clear</button>
                </div>
              </div>
              <p className="mt-3 text-xs text-neutral-400">
                Dates and times use your local timezone: {timeZone}.
              </p>
              {dateError && <p className="mt-2 text-sm text-red-300">{dateError}</p>}
            </div>
          )}
        </div>
      </section>

      {!loadState.hasLoaded ? (
        <StatePanel><span className="inline-flex items-center gap-2"><LoaderCircle className="animate-spin" size={17} /> Loading run history...</span></StatePanel>
      ) : entries.length === 0 ? (
        <StatePanel>No run history has been recorded yet.</StatePanel>
      ) : filteredEntries.length === 0 ? (
        <StatePanel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>No retained entries match these filters.</span>
            <button type="button" onClick={clearFilters} className="rounded-lg border border-line px-3 py-1.5 text-sm">Clear filters</button>
          </div>
        </StatePanel>
      ) : (
        <section className="space-y-3" aria-labelledby="run-history-heading">
          <div className="flex flex-col justify-between gap-2 px-1 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent/90">Run history</p>
              <h2 id="run-history-heading" tabIndex={-1} className="mt-1 text-xl font-semibold tracking-tight text-white outline-none">Recent runs</h2>
            </div>
            <p className="text-sm text-neutral-400">Showing {shownStart}-{shownEnd} of {filteredEntries.length} matching entries</p>
          </div>
          {pageEntries.map((entry) => {
            const originalIndex = entries.indexOf(entry);
            const key = entryKey(entry, originalIndex);
            const isOpen = expanded.has(key);
            const outcome = getRunOutcome(entry);
            const problems = collectRunProblems(entry);
            const mode = runModeLabel(entry);
            const detailsId = `${runElementId(key)}-details`;
            return (
              <article id={runElementId(key)} tabIndex={-1} key={key} className="rounded-xl border border-line bg-panel p-4 outline-none focus-visible:ring-2 focus-visible:ring-accent sm:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OutcomeIcon outcome={outcome} />
                      <h3 className="font-semibold">{runTitle(entry)}</h3>
                      <RunStatusPill entry={entry} />
                      {mode && <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-neutral-400">{mode}</span>}
                    </div>
                    <p className="mt-2 text-sm text-neutral-400">
                      {displayRunDate(entry.completedAt || entry.startedAt, timeZone)}
                      {runDuration(entry) ? ` - ${runDuration(entry)}` : ""}
                    </p>
                    <p className="mt-2 text-sm text-neutral-300">{runSummary(entry)}</p>
                    {problems.length > 0 && (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-amber-200">
                        {problems.length} {problems.length === 1 ? "warning" : "warnings"}: {problems[0]}
                      </p>
                    )}
                  </div>
                  <button type="button" aria-expanded={isOpen} aria-controls={detailsId} onClick={() => toggleEntry(key)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200">
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    {isOpen ? "Hide details" : "View details"}
                  </button>
                </div>
                {isOpen && (
                  <div id={detailsId}>
                    <RunDetails entry={entry} mediaServerLabel={mediaServerLabel} />
                  </div>
                )}
              </article>
            );
          })}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-neutral-400">Page {currentPage} of {totalPages}</p>
            <div className="flex gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)} className="min-h-10 rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-40">Previous</button>
              <button type="button" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)} className="min-h-10 rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-40">Next</button>
            </div>
          </div>
        </section>
      )}

    </div>
  );
}
