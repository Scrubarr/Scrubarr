import { useCallback, useEffect, useState } from "react";
import {
  LoaderCircle,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import StatePanel from "../components/StatePanel.jsx";
import MediaTypeBadge from "../components/MediaTypeBadge.jsx";
import CleanupPreview from "../components/CleanupPreview.jsx";
import {
  Field,
  HelpTooltip,
  NumberInput,
  OptionalNumberInput,
  SelectionChips,
  SelectInput,
  TextInput,
  Toggle,
} from "../components/FormControls.jsx";
import { useCloseDetailsOnOutsideClick } from "../hooks/useCloseDetailsOnOutsideClick.js";
import { requestJson } from "../lib/api.js";
import { mediaServerErrorMessage } from "../lib/mediaServerErrors.js";
import {
  clearValidationForPath,
  validationDetails,
  validationMessageFor,
  validationSummaryFor,
} from "../lib/validation.js";

const emptyFilters = {
  YearFrom: null,
  YearTo: null,
  IncludeGenres: [],
  ExcludeGenres: [],
};

function configuredSecret(value) {
  return Boolean(value) || value === true;
}

function updateAtPath(value, dottedPath, nextValue) {
  const result = structuredClone(value);
  const keys = dottedPath.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current[key], result);
  parent[finalKey] = nextValue;
  return result;
}

function normalizeFilters(filters, fallback = emptyFilters) {
  return {
    YearFrom: filters?.YearFrom ?? fallback.YearFrom ?? null,
    YearTo: filters?.YearTo ?? fallback.YearTo ?? null,
    IncludeGenres: Array.isArray(filters?.IncludeGenres)
      ? filters.IncludeGenres
      : Array.isArray(fallback.IncludeGenres)
        ? fallback.IncludeGenres
        : [],
    ExcludeGenres: Array.isArray(filters?.ExcludeGenres)
      ? filters.ExcludeGenres
      : Array.isArray(fallback.ExcludeGenres)
        ? fallback.ExcludeGenres
        : [],
  };
}

function normalizeCleanupSettings(settings) {
  const next = structuredClone(settings);
  const legacyFilters = normalizeFilters(next.CleanupFilters);
  next.Mode.MovieType ||= next.Mode.Type;
  next.Mode.SeriesType ||= next.Mode.Type;
  next.CleanupFilters.Movies = normalizeFilters(
    next.CleanupFilters.Movies,
    legacyFilters,
  );
  next.CleanupFilters.Series = normalizeFilters(next.CleanupFilters.Series, {
    ...emptyFilters,
    YearFrom: legacyFilters.YearFrom,
    YearTo: legacyFilters.YearTo,
  });
  return next;
}

function Section({
  title,
  description,
  icon,
  children,
  contentClassName = "grid min-w-0 gap-4 p-5 md:grid-cols-2",
}) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {icon && (
            <span className="text-accent" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

function GenrePicker({
  label,
  help,
  genres,
  state,
  selectedGenres,
  onChange,
  onRefresh,
  emptyLabel,
  providerLabel = "Media server",
  className = "",
  error,
}) {
  const detailsRef = useCloseDetailsOnOutsideClick();
  const options = [
    ...new Set([...genres.map(String), ...selectedGenres.map(String)]),
  ].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );

  function toggleGenre(genre) {
    const next = selectedGenres.includes(genre)
      ? selectedGenres.filter((item) => item !== genre)
      : [...selectedGenres, genre].sort((left, right) =>
          left.localeCompare(right, undefined, { sensitivity: "base" }),
        );
    onChange(next);
  }

  return (
    <div
      className={`block min-w-0 rounded-lg ${
        error ? "-m-2 p-2 outline outline-1 outline-red-700/80" : ""
      } ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          error ? "text-red-200" : "text-neutral-200"
        }`}
      >
        {label}
        <HelpTooltip text={help} />
      </span>
      <details ref={detailsRef} className="group relative mt-1">
        <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-white outline-none transition hover:border-neutral-500 group-open:border-accent">
          <SelectionChips values={selectedGenres} emptyText={emptyLabel} />
          <span className="text-xs text-neutral-400">Select</span>
        </summary>
        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-neutral-950 p-3 shadow-2xl">
          {selectedGenres.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onChange([])}
                className="mb-2 rounded-lg border border-line px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
              >
                Clear selection
              </button>
              <div className="mb-2 border-t border-line" />
            </>
          )}

          {state.state === "loading" ? (
            <p className="px-2 py-3 text-sm text-neutral-400">
              Loading {providerLabel} genres...
            </p>
          ) : state.state === "error" || state.state === "blocked" ? (
            <div
              className={`space-y-2 px-2 py-3 text-sm ${
                state.state === "error" ? "text-red-300" : "text-amber-200"
              }`}
            >
              <p>{state.message}</p>
              {state.state === "error" && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
                >
                  Retry
                </button>
              )}
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-400">
              No {providerLabel} genres found.
            </p>
          ) : (
            <div>
              {options.map((genre) => (
                <label
                  key={genre}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-yellow-400"
                    checked={selectedGenres.includes(genre)}
                    onChange={() => toggleGenre(genre)}
                  />
                  <span className="text-neutral-200">{genre}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <p className="mt-1 text-xs text-neutral-400">
        {selectedGenres.length > 0
          ? `${selectedGenres.length} selected genre${selectedGenres.length === 1 ? "" : "s"}.`
          : emptyLabel}
      </p>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function CleanupRuleSummary({ summary, error }) {
  const movieRules = summary?.movies || ["Loading rule summary..."];
  const seriesRules = summary?.series || ["Loading rule summary..."];
  const arrWarnings = summary?.warnings || [];

  return (
    <div className="md:col-span-2 rounded-xl border border-yellow-700/40 bg-yellow-950/10 p-4">
      <p className="text-sm font-semibold text-amber-200">Rule summary</p>
      {error && (
        <p className="mt-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="mt-3 grid gap-3 text-sm text-neutral-300 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-canvas/70 p-3">
          <MediaTypeBadge type="Movie" />
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            {movieRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-canvas/70 p-3">
          <MediaTypeBadge type="Series" />
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            {seriesRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </div>
      {arrWarnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-sm text-amber-100">
          <p className="font-medium">Arr guidance</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {arrWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PreviewModeExplanation({ enabled }) {
  return (
    <div
      className={`rounded-xl border p-4 text-sm leading-6 md:col-span-3 ${
        enabled
          ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-100"
          : "border-amber-800/60 bg-amber-950/20 text-amber-100"
      }`}
    >
      <p className="font-semibold">
        Preview only mode is {enabled ? "enabled" : "disabled"}
      </p>
      <p className="mt-1">
        {enabled
          ? "Scrubarr can scan, queue, notify, and report media, but it will not delete anything."
          : "Scheduled cleanup can delete expired pending media through Radarr/Sonarr. Review pending items before the next run."}
      </p>
    </div>
  );
}

function ModeSelect({ value, onChange }) {
  return (
    <SelectInput value={value} onChange={onChange}>
      <option value="watched">Watched media only</option>
      <option value="all">Watched and never watched media</option>
      <option value="unwatched">Never watched media only</option>
    </SelectInput>
  );
}

function ReleaseYearRange({ filterPath, filters, set, fieldError }) {
  return (
    <div className="grid min-w-0 gap-3 sm:col-span-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,14rem)] sm:justify-start xl:col-span-2">
      <Field
        label="Release year from"
        help="Optional filter. When set, Scrubarr only considers this media type from this year or later."
        error={fieldError(`${filterPath}.YearFrom`)}
      >
        <OptionalNumberInput
          value={filters.YearFrom}
          minimum={1800}
          placeholder="Any"
          className="max-w-56"
          onChange={(value) => set(`${filterPath}.YearFrom`, value)}
        />
      </Field>
      <Field
        label="Release year to"
        help="Optional filter. When set, Scrubarr only considers this media type from this year or earlier. Use this with Release year from for a years-between rule."
        error={fieldError(`${filterPath}.YearTo`)}
      >
        <OptionalNumberInput
          value={filters.YearTo}
          minimum={1800}
          placeholder="Any"
          className="max-w-56"
          onChange={(value) => set(`${filterPath}.YearTo`, value)}
        />
      </Field>
    </div>
  );
}

function MediaFilterSection({
  title,
  description,
  modePath,
  filterPath,
  settings,
  set,
  genres,
  genresState,
  loadGenres,
  fieldError,
  providerLabel,
  children,
}) {
  const filters = filterPath.split(".").reduce((current, key) => current[key], settings);

  return (
    <Section
      title={title}
      description={description}
      icon={<ShieldCheck size={19} />}
      contentClassName="grid min-w-0 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Field
        label="Mode"
        help="Choose whether this media type considers watched items, never watched items, or both."
        className="sm:col-span-2 xl:col-span-2"
        error={fieldError(modePath)}
      >
        <ModeSelect
          value={modePath.split(".").reduce((current, key) => current[key], settings)}
          onChange={(value) => set(modePath, value)}
        />
      </Field>
      <ReleaseYearRange
        filterPath={filterPath}
        filters={filters}
        set={set}
        fieldError={fieldError}
      />
      <GenrePicker
        label="Include genres"
        help={`Optional filter. When set, Scrubarr only considers this media type when it matches at least one selected ${providerLabel} genre.`}
        genres={genres}
        state={genresState}
        selectedGenres={filters.IncludeGenres}
        onChange={(value) => set(`${filterPath}.IncludeGenres`, value)}
        onRefresh={loadGenres}
        emptyLabel="No include genre filter"
        providerLabel={providerLabel}
        className="sm:col-span-2 xl:col-span-2"
        error={fieldError(`${filterPath}.IncludeGenres`)}
      />
      <GenrePicker
        label="Exclude genres"
        help="Optional filter. Matching media is skipped even if it passes the age rules."
        genres={genres}
        state={genresState}
        selectedGenres={filters.ExcludeGenres}
        onChange={(value) => set(`${filterPath}.ExcludeGenres`, value)}
        onRefresh={loadGenres}
        emptyLabel="No excluded genres"
        providerLabel={providerLabel}
        className="sm:col-span-2 xl:col-span-2"
        error={fieldError(`${filterPath}.ExcludeGenres`)}
      />
      {children}
    </Section>
  );
}

export default function CleanupRules() {
  const [settings, setSettings] = useState(null);
  const [ruleSummary, setRuleSummary] = useState(null);
  const [ruleSummaryError, setRuleSummaryError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState({ state: "idle", message: "" });
  const [mediaServerGenres, setMediaServerGenres] = useState([]);
  const [mediaServerGenresState, setMediaServerGenresState] = useState({
    state: "idle",
    message: "",
  });
  const [validationErrors, setValidationErrors] = useState([]);
  const settingsLoaded = settings !== null;
  const mediaServerProvider =
    settings?.MediaServer?.Provider === "jellyfin" ? "jellyfin" : "emby";
  const mediaServerSelected = settings?.MediaServer?.Locked === true;
  const mediaServerLabel = mediaServerSelected
    ? mediaServerProvider === "jellyfin"
      ? "Jellyfin"
      : "Emby"
    : "Media server";
  const mediaServerConfig =
    mediaServerProvider === "jellyfin" ? settings?.Jellyfin : settings?.Emby;
  const mediaServerHasServerDetails = Boolean(
    mediaServerSelected &&
      String(mediaServerConfig?.ServerUrl || "").trim() &&
      configuredSecret(mediaServerConfig?.ApiKeyConfigured),
  );

  const loadMediaServerGenres = useCallback(async () => {
    setMediaServerGenresState({ state: "loading", message: "" });
    try {
      const data = await requestJson("/api/settings/media-server/genres");
      setMediaServerGenres(data.genres || []);
      setMediaServerGenresState({ state: "idle", message: "" });
    } catch (error) {
      setMediaServerGenresState({
        state: "error",
        message: mediaServerErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    requestJson("/api/settings")
      .then((loadedSettings) => setSettings(normalizeCleanupSettings(loadedSettings)))
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    if (!mediaServerSelected) {
      setMediaServerGenres([]);
      setMediaServerGenresState({
        state: "blocked",
        message: "Choose Emby or Jellyfin in Settings before loading media server genres.",
      });
      return;
    }
    if (!mediaServerHasServerDetails) {
      setMediaServerGenres([]);
      setMediaServerGenresState({
        state: "blocked",
        message: `Finish the ${mediaServerLabel} server URL and API key before loading genres.`,
      });
      return;
    }
    loadMediaServerGenres();
  }, [
    settingsLoaded,
    mediaServerSelected,
    mediaServerHasServerDetails,
    mediaServerLabel,
    loadMediaServerGenres,
  ]);

  useEffect(() => {
    if (!settings) return undefined;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      requestJson("/api/settings/cleanup-summary", {
        method: "POST",
        body: JSON.stringify(settings),
      })
        .then((summary) => {
          if (!cancelled) {
            setRuleSummary(summary);
            setRuleSummaryError("");
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setRuleSummaryError(error.message);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [settings]);

  function set(path, value) {
    setSettings((current) => updateAtPath(current, path, value));
    setValidationErrors((current) => clearValidationForPath(current, path));
  }

  async function save(event) {
    event.preventDefault();
    setValidationErrors([]);
    setSaveState({ state: "loading", message: "Saving cleanup rules..." });
    try {
      const data = await requestJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(normalizeCleanupSettings(data.settings));
      setValidationErrors([]);
      setSaveState({ state: "success", message: "Cleanup rules saved." });
    } catch (error) {
      setValidationErrors(validationDetails(error));
      setSaveState({ state: "error", message: validationSummaryFor(error) });
    }
  }

  if (loadError) return <StatePanel tone="error">{loadError}</StatePanel>;
  if (!settings) return <StatePanel>Loading cleanup rules...</StatePanel>;

  const fieldError = (paths) => validationMessageFor(validationErrors, paths);
  const providerLabel = mediaServerSelected ? mediaServerLabel : "media server";

  return (
    <form className="space-y-6" onSubmit={save} noValidate>
      <section>
        <p className="text-sm font-medium text-accent">Rules</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Cleanup Rules</h1>
        <p className="mt-2 max-w-3xl text-neutral-400">
          Control which movies and series Scrubarr can mark as pending deletion.
        </p>
      </section>

      <CleanupPreview previewOnly={settings.CleanupRules.DryRun} />

      <Section
        title="Summary"
        icon={<SlidersHorizontal size={19} />}
        description="A plain-English view of the rules currently selected below."
      >
        <CleanupRuleSummary summary={ruleSummary} error={ruleSummaryError} />
      </Section>

      <Section
        title="Shared age rules"
        icon={<SlidersHorizontal size={19} />}
        description="Age checks used by both movie and series cleanup."
        contentClassName="grid min-w-0 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3"
      >
        <Field
          label="Watched age (days)"
          help={`Media with ${providerLabel} playback history qualifies only when its last watched date is at least this many days ago.`}
          error={fieldError("Mode.WatchedDays")}
        >
          <NumberInput
            value={settings.Mode.WatchedDays}
            className="max-w-44"
            onChange={(value) => set("Mode.WatchedDays", value)}
          />
        </Field>
        <Field
          label="Never watched age (days)"
          help="Only used when a movie or series mode includes never watched media. Because there is no last-watched date, Scrubarr uses the oldest available added date, preferring Arr added date when available."
          error={fieldError("Mode.UnwatchedDays")}
        >
          <NumberInput
            value={settings.Mode.UnwatchedDays}
            className="max-w-44"
            onChange={(value) => set("Mode.UnwatchedDays", value)}
          />
        </Field>
        <Field
          label="Minimum Arr age (days)"
          help="Optional extra safety gate. This does not qualify media by itself; it only blocks media that has not been in Radarr/Sonarr long enough."
          error={fieldError("Mode.DaysOlderThan")}
        >
          <NumberInput
            value={settings.Mode.DaysOlderThan}
            className="max-w-44"
            onChange={(value) => set("Mode.DaysOlderThan", value)}
          />
        </Field>
      </Section>

      <MediaFilterSection
        title="Movie rules"
        description="Movie-only mode, release year, and genre filters."
        modePath="Mode.MovieType"
        filterPath="CleanupFilters.Movies"
        settings={settings}
        set={set}
        genres={mediaServerGenres}
        genresState={mediaServerGenresState}
        loadGenres={loadMediaServerGenres}
        providerLabel={providerLabel}
        fieldError={fieldError}
      />

      <MediaFilterSection
        title="Series rules"
        description="Whole-series cleanup using episode playback, release year, and genre filters."
        modePath="Mode.SeriesType"
        filterPath="CleanupFilters.Series"
        settings={settings}
        set={set}
        genres={mediaServerGenres}
        genresState={mediaServerGenresState}
        loadGenres={loadMediaServerGenres}
        providerLabel={providerLabel}
        fieldError={fieldError}
      />

      <Section
        title="Queue and safety"
        icon={<ShieldCheck size={19} />}
        description="Queue limits, review window, and deletion safeguards."
        contentClassName="grid min-w-0 gap-4 p-5 md:grid-cols-3"
      >
        <PreviewModeExplanation enabled={settings.CleanupRules.DryRun} />
        <Field
          label="Maximum movies marked"
          help="Maximum number of new movies Scrubarr may add to the pending queue in one run."
          error={fieldError("Limits.MaxMoviesMarked")}
        >
          <NumberInput
            value={settings.Limits.MaxMoviesMarked}
            className="max-w-44"
            onChange={(value) => set("Limits.MaxMoviesMarked", value)}
          />
        </Field>
        <Field
          label="Maximum series marked"
          help="Maximum number of new series Scrubarr may add to the pending queue in one run."
          error={fieldError("Limits.MaxSeriesMarked")}
        >
          <NumberInput
            value={settings.Limits.MaxSeriesMarked}
            className="max-w-44"
            onChange={(value) => set("Limits.MaxSeriesMarked", value)}
          />
        </Field>
        <Field
          label="Days until deletion"
          help="How many days an item remains pending after being marked before cleanup can remove it."
          error={fieldError([
            "DeletionSchedule.DaysUntilDeletion",
            "DeletionSchedule.NotificationDays",
          ])}
        >
          <NumberInput
            value={settings.DeletionSchedule.DaysUntilDeletion}
            minimum={1}
            className="max-w-44"
            onChange={(value) => set("DeletionSchedule.DaysUntilDeletion", value)}
          />
        </Field>
        <Toggle
          label="Protect in-progress media"
          help={`When enabled, Scrubarr records when media first appears in ${providerLabel}'s Continue Watching list and skips it until that in-progress age is older than Never watched age.`}
          warning="Recommended if people often pause and continue media later. Abandoned Continue Watching items can still qualify after the configured age."
          checked={settings.CleanupRules.ProtectInProgress}
          onChange={(value) => set("CleanupRules.ProtectInProgress", value)}
          className="md:col-span-3"
          error={fieldError("CleanupRules.ProtectInProgress")}
        />
        <Toggle
          label="Preview only mode"
          help="Enabled means scan, queue, notify, and report only. Disabled means expired pending media can be deleted during scheduled cleanup."
          warning={
            settings.CleanupRules.DryRun
              ? "Enabled: Scrubarr will not delete media."
              : "Disabled: expired pending media can be deleted during scheduled cleanup."
          }
          checked={settings.CleanupRules.DryRun}
          onChange={(value) => set("CleanupRules.DryRun", value)}
          className="md:col-span-3"
          error={fieldError("CleanupRules.DryRun")}
        />
        <Toggle
          label="Tag pending items in Radarr/Sonarr"
          help="Optional. When Scrubarr adds media to the pending queue, it can also add a tag in Radarr or Sonarr so the item is easy to spot there. Scrubarr's own pending queue remains the source of truth."
          warning={
            settings.Arrs.PendingTag.Enabled
              ? "Scrubarr will try to add and remove this tag as pending items change."
              : ""
          }
          checked={settings.Arrs.PendingTag.Enabled}
          onChange={(value) => set("Arrs.PendingTag.Enabled", value)}
          className="md:col-span-3"
          error={fieldError("Arrs.PendingTag.Enabled")}
        />
        {settings.Arrs.PendingTag.Enabled && (
          <Field
            label="Arr pending tag name"
            help="The Radarr/Sonarr tag Scrubarr will use for pending items. Use lowercase letters, numbers, and hyphens only. Example: scrubarr-pending."
            className="md:col-span-3 max-w-md"
            error={fieldError("Arrs.PendingTag.Name")}
          >
            <TextInput
              value={settings.Arrs.PendingTag.Name}
              placeholder="scrubarr-pending"
              pattern="[a-z0-9-]+"
              title="Use lowercase letters, numbers, and hyphens only. Example: scrubarr-pending."
              autoComplete="off"
              onChange={(value) => set("Arrs.PendingTag.Name", value)}
            />
          </Field>
        )}
        <Toggle
          label="Direct file deletion fallback"
          help="Allow Scrubarr to attempt direct media file deletion only when Arr deletion cannot be used. The server still refuses direct deletion unless approved media roots are configured."
          warning="High risk. This can delete media files directly, but Scrubarr will refuse broad or unapproved paths."
          tone="danger"
          checked={settings.CleanupRules.FallbackFileDeletion}
          onChange={(value) => set("CleanupRules.FallbackFileDeletion", value)}
          className="md:col-span-3"
          error={fieldError("CleanupRules.FallbackFileDeletion")}
        />
      </Section>

      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur">
        {saveState.message && (
          <span
            className={`mr-auto text-sm ${
              saveState.state === "error" ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {saveState.message}
          </span>
        )}
        <button
          type="submit"
          disabled={saveState.state === "loading"}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60"
        >
          {saveState.state === "loading" ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}
          Save cleanup rules
        </button>
      </div>
    </form>
  );
}
