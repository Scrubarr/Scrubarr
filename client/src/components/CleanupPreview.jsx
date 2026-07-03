import { useState } from "react";
import {
  Eye,
  LoaderCircle,
  Play,
  Plus,
  ShieldCheck,
  ShieldPlus,
  X,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ConfirmMediaDetail from "./ConfirmMediaDetail.jsx";
import MediaCard from "./MediaCard.jsx";
import StatePanel from "./StatePanel.jsx";
import { requestJson } from "../lib/api.js";
import { mediaServerErrorMessage } from "../lib/mediaServerErrors.js";

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

const skipReasonText = {
  "already-pending": "Already in the pending queue",
  excluded: "Protected by exclusions",
  "movie-limit": "Movie queue limit reached",
  "series-limit": "Series queue limit reached",
  "age-rule-not-met": "Did not meet the selected age rules",
  "watched-rule-not-met": "Watched rule was not met",
  "unwatched-rule-not-met": "Never watched rule was not met",
  "too-new": "Too new in Radarr/Sonarr",
  "missing-arr-date": "Missing Radarr/Sonarr added date",
  "in-progress": "Still protected as Continue Watching",
  "watch-history-unknown": "Watch history could not be confirmed",
  "genre-not-included": "Genre did not match the include filter",
  "genre-excluded": "Genre matched the exclude filter",
  "year-before-filter": "Release year was before the selected range",
  "year-after-filter": "Release year was after the selected range",
};

function skipReasonLabel(reason) {
  return skipReasonText[reason] || reason.replaceAll("-", " ");
}

function topSkipReasons(skipped = {}, limit = 4) {
  return Object.entries(skipped)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, limit);
}

function zeroCandidateMessage(summary) {
  const skipped = summary?.skipped || {};
  const movieLimit = Number(skipped["movie-limit"] || 0);
  const seriesLimit = Number(skipped["series-limit"] || 0);

  if (movieLimit > 0 && seriesLimit > 0) {
    return "Preview complete: 0 candidates. Movie and series queue limits are already reached.";
  }
  if (movieLimit > 0) {
    return "Preview complete: 0 candidates. Movie queue limit is already reached.";
  }
  if (seriesLimit > 0) {
    return "Preview complete: 0 candidates. Series queue limit is already reached.";
  }

  const [reason, count] = topSkipReasons(skipped, 1)[0] || [];
  if (reason) {
    return `Preview complete: 0 candidates. Most items were skipped because: ${skipReasonLabel(reason)} (${count}).`;
  }

  return "Preview complete: 0 candidates. No media matched the saved cleanup rules.";
}

function ZeroCandidateExplanation({ preview }) {
  const skipped = preview.summary.skipped || {};
  const topReasons = topSkipReasons(skipped);
  const movieLimit = Number(skipped["movie-limit"] || 0);
  const seriesLimit = Number(skipped["series-limit"] || 0);
  const limitMessage =
    movieLimit > 0 && seriesLimit > 0
      ? "The movie and series queue limits are already reached, so matching media was skipped instead of being shown as new candidates."
      : movieLimit > 0
        ? "The movie queue limit is already reached, so matching movies were skipped instead of being shown as new candidates."
        : seriesLimit > 0
          ? "The series queue limit is already reached, so matching series were skipped instead of being shown as new candidates."
          : null;

  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-sm font-medium text-neutral-200">
        No new candidates were available.
      </p>
      {limitMessage ? (
        <p className="mt-2 text-sm leading-6 text-neutral-400">{limitMessage}</p>
      ) : (
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          Scrubarr scanned your libraries, but everything was skipped by the
          saved cleanup rules or existing protection state.
        </p>
      )}
      {topReasons.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            Most common skip reasons
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-neutral-300">
            {topReasons.map(([reason, count]) => (
              <li key={reason}>
                {skipReasonLabel(reason)}: {count}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CleanupPreview({ previewOnly = true }) {
  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState({
    state: "idle",
    message: "",
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [queueState, setQueueState] = useState({
    state: "idle",
    message: "",
  });
  const [confirmQueueOpen, setConfirmQueueOpen] = useState(false);
  const [excludeCandidate, setExcludeCandidate] = useState(null);
  const [busyExcludeId, setBusyExcludeId] = useState("");

  async function runPreview() {
    setPreviewState({ state: "loading", message: "Scanning configured libraries..." });
    setPreview(null);
    setSelectedIds([]);
    setQueueState({ state: "idle", message: "" });
    try {
      const data = await requestJson("/api/scans/preview", { method: "POST" });
      setPreview(data);
      setPreviewState({
        state: "success",
        message:
          data.candidates.length === 0
            ? zeroCandidateMessage(data.summary)
            : `Preview complete: ${data.candidates.length} candidate${
                data.candidates.length === 1 ? "" : "s"
              }.`,
      });
    } catch (requestError) {
      setPreviewState({ state: "error", message: mediaServerErrorMessage(requestError) });
    }
  }

  function toggleSelection(itemId) {
    setSelectedIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function toggleAllCandidates() {
    if (!preview) return;
    setSelectedIds((current) =>
      current.length === preview.candidates.length
        ? []
        : preview.candidates.map((item) => item.ItemId),
    );
  }

  function clearPreview() {
    setPreview(null);
    setSelectedIds([]);
    setConfirmQueueOpen(false);
    setExcludeCandidate(null);
    setPreviewState({ state: "idle", message: "" });
  }

  async function addSelectedToQueue() {
    if (selectedIds.length === 0) return;

    setConfirmQueueOpen(false);
    setQueueState({ state: "loading", message: "Revalidating selected items..." });
    try {
      const data = await requestJson("/api/scans/commit", {
        method: "POST",
        body: JSON.stringify({ itemIds: selectedIds }),
      });
      setPreview(null);
      setSelectedIds([]);
      setConfirmQueueOpen(false);
      const skipped = data.skippedItemIds?.length || 0;
      setQueueState({
        state: "success",
        message: `${data.added.length} item${
          data.added.length === 1 ? "" : "s"
        } added to the pending queue${
          skipped ? `; ${skipped} skipped after revalidation` : ""
        }.`,
      });
    } catch (requestError) {
      setQueueState({ state: "error", message: mediaServerErrorMessage(requestError) });
    }
  }

  async function excludeFromPreview(item) {
    setExcludeCandidate(null);
    setBusyExcludeId(item.ItemId);
    setQueueState({ state: "loading", message: `Adding ${item.Title} to exclusions...` });
    try {
      await requestJson("/api/exclusions", {
        method: "POST",
        body: JSON.stringify(item),
      });
      setPreview((current) =>
        current
          ? {
              ...current,
              candidates: current.candidates.filter(
                (candidate) => candidate.ItemId !== item.ItemId,
              ),
            }
          : current,
      );
      setSelectedIds((current) => current.filter((id) => id !== item.ItemId));
      setQueueState({
        state: "success",
        message: `${item.Title} was added to exclusions and removed from the preview results.`,
      });
    } catch (requestError) {
      setQueueState({ state: "error", message: mediaServerErrorMessage(requestError) });
    } finally {
      setBusyExcludeId("");
    }
  }

  return (
    <div className="space-y-5">
      <ConfirmDialog
        open={confirmQueueOpen}
        icon={<ShieldCheck size={22} />}
        title="Add selected items?"
        message={
          previewOnly
            ? "Scrubarr will recheck the selected media, then add matching items to the pending queue. Preview only mode is enabled, so media will not be deleted."
            : "Preview only mode is disabled. Scrubarr will recheck the selected media and add matching items to the pending queue. Pending media can be deleted by a live cleanup run once its countdown reaches zero."
        }
        tone={previewOnly ? "accent" : "danger"}
        confirmLabel="Add to pending queue"
        onCancel={() => setConfirmQueueOpen(false)}
        onConfirm={addSelectedToQueue}
        detail={
          <div className="space-y-3">
            {!previewOnly && (
              <div className="rounded-lg border border-red-900/70 bg-red-950/30 p-3 text-sm font-medium leading-6 text-red-200">
                Live cleanup can delete these items after their review window ends.
              </div>
            )}
            <div>
              <div className="text-sm text-neutral-400">Selected items</div>
              <div className="mt-1 text-3xl font-semibold text-accent">
                {selectedIds.length}
              </div>
            </div>
          </div>
        }
      />
      <ConfirmDialog
        open={Boolean(excludeCandidate)}
        icon={<ShieldPlus size={22} />}
        title="Exclude this item?"
        message="Scrubarr will add this media to exclusions and remove it from the current preview results."
        confirmLabel="Add exclusion"
        onCancel={() => setExcludeCandidate(null)}
        onConfirm={() => excludeFromPreview(excludeCandidate)}
        detail={<ConfirmMediaDetail item={excludeCandidate} />}
      />

      {queueState.message && (
        <StatePanel tone={queueState.state === "error" ? "error" : "neutral"}>
          {queueState.message}
        </StatePanel>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex flex-col justify-between gap-5 border-b border-line p-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="text-accent" size={20} />
              <h2 className="text-xl font-semibold">Cleanup preview</h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              Scan your libraries and review media that matches the current
              cleanup rules.
            </p>
          </div>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewState.state === "loading"}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60"
          >
            {previewState.state === "loading" ? (
              <LoaderCircle className="animate-spin" size={17} />
            ) : (
              <Play size={17} />
            )}
            Preview scan
          </button>
        </div>
        <div className="flex items-center gap-2 bg-canvas/40 px-5 py-3 text-xs text-neutral-400">
          <ShieldCheck className="text-emerald-400" size={16} />
          Preview scan: no queue changes are made until you choose them
        </div>
        {previewState.message && (
          <div
            className={`border-t px-5 py-3 text-sm ${
              previewState.state === "error"
                ? "border-red-900/60 bg-red-950/30 text-red-200"
                : "border-line text-neutral-300"
            }`}
          >
            {previewState.message}
          </div>
        )}
      </section>

      {preview && (
        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Eye className="text-accent" size={21} />
                <h2 className="text-xl font-semibold">Preview results</h2>
              </div>
              <p className="mt-1 text-sm text-neutral-400">
                Results generated{" "}
                {new Date(preview.generatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-900/60 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-300">
                No changes made
              </span>
              <button
                type="button"
                onClick={clearPreview}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:text-white"
              >
                <X size={13} />
                Clear results
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Items scanned" value={preview.summary.scanned} />
            <Stat
              label="Candidate movies"
              value={preview.summary.candidateMovies}
            />
            <Stat
              label="Candidate series"
              value={preview.summary.candidateSeries}
            />
            <Stat
              label="Skipped items"
              value={Object.values(preview.summary.skipped).reduce(
                (total, count) => total + count,
                0,
              )}
            />
          </div>

          {preview.warnings?.map((warning) => (
            <StatePanel key={warning} tone="error">
              {warning}
            </StatePanel>
          ))}

          {preview.candidates.length === 0 ? (
            <ZeroCandidateExplanation preview={preview} />
          ) : (
            <>
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-line bg-panel p-4 sm:flex-row sm:items-center">
                <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-yellow-400"
                    checked={
                      selectedIds.length === preview.candidates.length &&
                      preview.candidates.length > 0
                    }
                    onChange={toggleAllCandidates}
                  />
                  Select all {preview.candidates.length} candidates
                </label>
                <button
                  type="button"
                  onClick={() => setConfirmQueueOpen(true)}
                  disabled={
                    selectedIds.length === 0 || queueState.state === "loading"
                  }
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {queueState.state === "loading" ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  Add selected ({selectedIds.length})
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {preview.candidates.map((item) => {
                  const selected = selectedIds.includes(item.ItemId);
                  return (
                    <MediaCard
                      key={item.ItemId}
                      item={item}
                      selected={selected}
                      className="gap-4 p-4 transition"
                      contentClassName="min-w-0 flex-1 pr-8"
                      metaClassName="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400"
                      showQualification
                      titleClassName="line-clamp-2 font-semibold text-accent"
                      selectControl={
                        <label className="absolute right-3 top-3 grid cursor-pointer place-items-center rounded-md bg-canvas p-2">
                          <span className="sr-only">Select {item.Title}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-yellow-400"
                            checked={selected}
                            onChange={() => toggleSelection(item.ItemId)}
                          />
                        </label>
                      }
                      actionsClassName="mt-4"
                      actions={
                        <button
                          type="button"
                          onClick={() => setExcludeCandidate(item)}
                          disabled={busyExcludeId === item.ItemId}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-neutral-300 hover:border-yellow-700 hover:text-accent disabled:opacity-50"
                        >
                          {busyExcludeId === item.ItemId ? (
                            <LoaderCircle className="animate-spin" size={14} />
                          ) : (
                            <Plus size={14} />
                          )}
                          Exclude
                        </button>
                      }
                    />
                  );
                })}
              </div>
            </>
          )}

          {Object.keys(preview.summary.skipped).length > 0 && (
            <details className="rounded-xl border border-line bg-panel p-4">
              <summary className="cursor-pointer text-sm font-medium">
                View skipped-item summary
              </summary>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(preview.summary.skipped).map(([reason, count]) => (
                  <div
                    key={reason}
                    className="flex justify-between gap-3 rounded-lg bg-canvas px-3 py-2 text-neutral-400"
                  >
                    <span>{skipReasonLabel(reason)}</span>
                    <span className="font-medium text-white">{count}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
