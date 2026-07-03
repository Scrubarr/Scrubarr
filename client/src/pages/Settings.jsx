import { useEffect, useState } from "react";
import {
  CircleAlert,
  ClipboardList,
  Copy,
  Download,
  Info,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import StatePanel from "../components/StatePanel.jsx";
import {
  Field,
  HelpTooltip,
  SelectionChips,
  SelectInput,
  TextInput,
  Toggle,
} from "../components/FormControls.jsx";
import {
  ServiceTestButton,
  SettingsSection,
} from "../components/SettingsSection.jsx";
import embyLogo from "../assets/logos/emby.svg";
import jellyfinLogo from "../assets/logos/jellyfin.svg";
import radarrLogo from "../assets/logos/radarr.svg";
import sonarrLogo from "../assets/logos/sonarr.svg";
import telegramLogo from "../assets/logos/telegram.svg";
import { requestJson } from "../lib/api.js";
import { inputClass } from "../lib/formClasses.js";
import { useCloseDetailsOnOutsideClick } from "../hooks/useCloseDetailsOnOutsideClick.js";
import {
  clearValidationForPath,
  validationDetails,
  validationMessageFor,
} from "../lib/validation.js";

const telegramNotificationPolicies = [
  {
    value: "standard",
    label: "Standard reminders",
    description:
      "First-day summary, sensible reminder milestones, deletion reports, and critical alerts.",
  },
  {
    value: "full",
    label: "Full activity",
    description:
      "First-day summary, every pending reminder day, deletion reports, and critical alerts.",
  },
  {
    value: "lifecycle",
    label: "Lifecycle only",
    description:
      "First-day summary, deletion reports, and critical alerts with no in-between reminders.",
  },
];

const safeFullRestoreSections = [
  "settings",
  "exclusions",
  "scheduler",
  "activity",
  "history",
];

const backupRestoreSections = [
  {
    value: "settings",
    label: "Settings",
    description:
      "Connections, cleanup rules, notifications, access control, and app preferences.",
  },
  {
    value: "exclusions",
    label: "Exclusions",
    description:
      "Protected movies and series that Scrubarr should skip.",
  },
  {
    value: "scheduler",
    label: "Scheduler",
    description:
      "Scheduled-run configuration and the last scheduler result.",
  },
  {
    value: "activity",
    label: "In-progress tracking",
    description:
      "Scrubarr tracking for items currently in Continue Watching.",
  },
  {
    value: "history",
    label: "Run and deletion history",
    description:
      "Run log, deleted-history totals, and dashboard deletion statistics.",
  },
  {
    value: "pending",
    label: "Pending queue from backup",
    description:
      "Advanced: restores old pending records from the backup. These may be stale or invalid if the Leaving Soon queue files, source media, or Arr records have changed. Usually leave this off; Scrubarr will rebuild current pending items from the media server Leaving Soon folders when possible.",
    warning: true,
  },
];

const mediaServerProviders = [
  {
    id: "emby",
    name: "Emby",
    logo: embyLogo,
    description: "Use Emby playback history, libraries, and images.",
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    logo: jellyfinLogo,
    description: "Use Jellyfin playback history, libraries, and images.",
  },
];

const queueSubfolders = {
  Movies: "Scrubarr Movies Leaving Soon",
  Series: "Scrubarr Shows Leaving Soon",
};

function queuePathSeparator(value) {
  const text = String(value || "");
  return text.includes("\\") || /^[a-z]:/i.test(text) ? "\\" : "/";
}

function joinQueuePath(root, subfolder) {
  const cleanRoot = String(root || "").trim().replace(/[\\/]+$/, "");
  if (!cleanRoot) return "";
  return `${cleanRoot}${queuePathSeparator(root)}${subfolder}`;
}

function isUpToDateMessage(message) {
  return /up to date/i.test(String(message || ""));
}

function UpdateSuccessPill({ children, size = "sm" }) {
  const sizeClass =
    size === "xs" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border border-emerald-800/70 bg-emerald-950/45 font-medium text-emerald-200 ${sizeClass}`}
    >
      {children}
    </span>
  );
}

function cleanQueuePath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

function parentPath(value) {
  const cleanPath = cleanQueuePath(value);
  const slash = Math.max(cleanPath.lastIndexOf("\\"), cleanPath.lastIndexOf("/"));
  if (slash <= 0) return "";
  return cleanPath.slice(0, slash);
}

function queueRootFromPaths(paths = {}) {
  const moviePath = cleanQueuePath(paths.Movies);
  const seriesPath = cleanQueuePath(paths.Series);
  if (moviePath && moviePath === seriesPath) return moviePath;

  const movieParent = parentPath(paths.Movies);
  const seriesParent = parentPath(paths.Series);
  if (movieParent && movieParent === seriesParent) return movieParent;
  return movieParent || seriesParent || "";
}

function dockerTagFromVersion(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function dockerUpdateCommandText(targetTag) {
  const tag = dockerTagFromVersion(targetTag) || "vX.X.X";
  return [
    "# In the folder containing Scrubarr's docker-compose.yml",
    `# First edit the Scrubarr image tag to: ghcr.io/scrubarr/scrubarr:${tag}`,
    "docker compose pull scrubarr",
    "docker compose up -d --no-deps scrubarr",
    "docker compose ps scrubarr",
    "docker compose logs --tail=100 scrubarr",
  ].join("\n");
}

async function fetchMediaServerUsers() {
  return requestJson("/api/settings/media-server/users");
}

async function fetchMediaServerLibraries(draftSettings) {
  return draftSettings
    ? requestJson("/api/settings/media-server/libraries", {
        method: "POST",
        body: JSON.stringify(draftSettings),
      })
    : requestJson("/api/settings/media-server/libraries");
}

function formatDateTime(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function updateAtPath(value, dottedPath, nextValue) {
  const result = structuredClone(value);
  const keys = dottedPath.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current[key], result);
  parent[finalKey] = nextValue;
  return result;
}

function SecretInput({ value, configured, onChange }) {
  return (
    <div>
      <input
        className={inputClass}
        type="password"
        autoComplete="new-password"
        value={value || ""}
        placeholder={configured ? "••••••••••••••••" : "Not configured"}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function EmbyUsersPicker({
  providerLabel = "Emby",
  users,
  state,
  selectedIds,
  onChange,
  onRefresh,
  error,
}) {
  const detailsRef = useCloseDetailsOnOutsideClick();
  const [customMode, setCustomMode] = useState(false);
  const allSelected = selectedIds.length === 0 && !customMode;
  const selectedNames = allSelected
    ? [`All ${providerLabel} users`]
    : users
        .filter((user) => selectedIds.includes(user.id))
        .map((user) => user.name);

  function selectAll() {
    setCustomMode(false);
    onChange([]);
  }

  function chooseIndividuals() {
    setCustomMode(true);
  }

  function toggleUser(userId) {
    setCustomMode(true);
    const next = selectedIds.includes(userId)
      ? selectedIds.filter((id) => id !== userId)
      : [...selectedIds, userId];
    onChange(next);
  }

  return (
    <div
      className={`block min-w-0 rounded-lg ${
        error ? "-m-2 p-2 outline outline-1 outline-red-700/80" : ""
      }`}
    >
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          error ? "text-red-200" : "text-neutral-200"
        }`}
      >
        {providerLabel} users
        <HelpTooltip text={`Choose which ${providerLabel} users Scrubarr should use for playback state. Select All to combine playback state from every ${providerLabel} user.`} />
      </span>
      <details ref={detailsRef} className="group relative mt-1">
        <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-white outline-none transition hover:border-neutral-500 group-open:border-accent">
          <SelectionChips
            values={selectedNames}
            emptyText={`Choose ${providerLabel} users`}
          />
          <span className="text-xs text-neutral-400">Select</span>
        </summary>
        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-neutral-950 p-3 shadow-2xl">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-yellow-400"
              checked={allSelected}
              onChange={(event) =>
                event.target.checked ? selectAll() : chooseIndividuals()
              }
            />
            <span>
              <span className="block font-medium">All {providerLabel} users</span>
              <span className="block text-xs text-neutral-400">
                Use combined playback state from everyone.
              </span>
            </span>
          </label>

          <div className="my-2 border-t border-line" />

          {state.state === "loading" ? (
            <p className="px-2 py-3 text-sm text-neutral-400">Loading {providerLabel} users...</p>
          ) : state.state === "error" ? (
            <div className="space-y-2 px-2 py-3 text-sm text-red-300">
              <p>{state.message}</p>
              <button
                type="button"
                onClick={onRefresh}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-500"
              >
                Retry
              </button>
            </div>
          ) : users.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-400">
              No {providerLabel} users found.
            </p>
          ) : (
            <div>
              {users.map((user) => (
                <label
                  key={user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-yellow-400"
                    checked={!allSelected && selectedIds.includes(user.id)}
                    onChange={() => toggleUser(user.id)}
                  />
                  <span>
                    <span className="block text-neutral-200">{user.name}</span>
                    <span className="block text-xs text-neutral-400">{user.id}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <p className="mt-1 text-xs text-neutral-400">
        {allSelected
          ? "All users are included. Choose individual users only if you want to narrow playback checks."
          : selectedIds.length > 0
            ? `${selectedIds.length} selected user${selectedIds.length === 1 ? "" : "s"}.`
            : `All is off. Select one or more ${providerLabel} users, or turn All back on.`}
      </p>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function SearchLibrariesPicker({
  providerLabel = "Emby",
  libraries,
  state,
  selectedNames,
  onChange,
  onRefresh,
  error,
}) {
  const detailsRef = useCloseDetailsOnOutsideClick();
  const selected = Array.isArray(selectedNames)
    ? selectedNames.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const selectedSet = new Set(selected.map((name) => name.toLowerCase()));
  const optionNames = new Set(
    libraries.map((library) => String(library.name || "").toLowerCase()),
  );
  const savedOnlyLibraries = selected
    .filter((name) => !optionNames.has(name.toLowerCase()))
    .map((name) => ({ id: `saved-${name}`, name, type: "Saved" }));
  const displayLibraries = [...libraries, ...savedOnlyLibraries];
  const selectedLabel =
    selected.length > 0
      ? selected
      : `Choose ${providerLabel} libraries`;

  function toggleLibrary(name) {
    const normalized = String(name || "").trim();
    if (!normalized) return;
    const exists = selectedSet.has(normalized.toLowerCase());
    onChange(
      exists
        ? selected.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
        : [...selected, normalized],
    );
  }

  return (
    <div
      className={`block min-w-0 rounded-lg ${
        error ? "-m-2 p-2 outline outline-1 outline-red-700/80" : ""
      }`}
    >
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium ${
          error ? "text-red-200" : "text-neutral-200"
        }`}
      >
        Search libraries
        <HelpTooltip text={`Choose the ${providerLabel} libraries Scrubarr can scan. The list is loaded from ${providerLabel}, so test the connection or refresh after entering server details.`} />
      </span>
      <details ref={detailsRef} className="group relative mt-1">
        <summary className="flex min-h-11 min-w-0 cursor-pointer list-none items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-white outline-none transition hover:border-neutral-500 group-open:border-accent">
          <SelectionChips
            values={selected.length > 0 ? selectedLabel : []}
            emptyText={selectedLabel}
          />
          <span className="text-xs text-neutral-400">Select</span>
        </summary>
        <div className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-neutral-950 p-3 shadow-2xl">
          <button
            type="button"
            onClick={onRefresh}
            className="mb-2 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-500"
          >
            <RefreshCw size={13} />
            Refresh libraries
          </button>

          {state.state === "loading" ? (
            <p className="px-2 py-3 text-sm text-neutral-400">
              Loading {providerLabel} libraries...
            </p>
          ) : state.state === "error" ? (
            <div className="space-y-2 px-2 py-3 text-sm text-red-300">
              <p>{state.message}</p>
              <p className="text-xs text-neutral-400">
                Confirm the {providerLabel} URL and API key, then test the connection.
              </p>
            </div>
          ) : displayLibraries.length === 0 ? (
            <p className="px-2 py-3 text-sm text-neutral-400">
              No movie or show libraries found yet.
            </p>
          ) : (
            <div>
              {displayLibraries.map((library) => (
                <label
                  key={library.id || library.name}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-yellow-400"
                    checked={selectedSet.has(String(library.name).toLowerCase())}
                    onChange={() => toggleLibrary(library.name)}
                  />
                  <span>
                    <span className="block text-neutral-200">{library.name}</span>
                    <span className="block text-xs text-neutral-400">
                      {library.type || "Library"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </details>
      <p className="mt-1 text-xs text-neutral-400">
        {selected.length > 0
          ? `${selected.length} selected librar${selected.length === 1 ? "y" : "ies"}.`
          : `Select one or more ${providerLabel} libraries to scan.`}
      </p>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

function LocalhostUrlWarning({ value }) {
  let hostname = "";
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) return null;

  return (
    <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100">
      <CircleAlert className="mt-0.5 shrink-0" size={15} />
      <span>
        In Docker, localhost points at the Scrubarr container. Use a reachable host
        address instead, such as your server LAN IP or host.docker.internal,
        and include the port.
      </span>
    </div>
  );
}

const serverUrlHelp = {
  Emby:
    "Enter the full Emby URL Scrubarr should call, including http:// or https:// and the port. Docker example: http://host.docker.internal:8096. LAN example: http://192.168.0.10:8096.",
  Jellyfin:
    "Enter the full Jellyfin URL Scrubarr should call, including http:// or https:// and the port. Docker example: http://host.docker.internal:8096. LAN example: http://192.168.0.10:8096.",
  Radarr:
    "Enter the full Radarr URL Scrubarr should call, including http:// or https:// and the port. Docker example: http://host.docker.internal:7878. LAN example: http://192.168.0.10:7878.",
  Sonarr:
    "Enter the full Sonarr URL Scrubarr should call, including http:// or https:// and the port. Docker example: http://host.docker.internal:8989. LAN example: http://192.168.0.10:8989.",
};

function BackupImportDetail({ candidate, onRestoreModeChange, onSectionToggle }) {
  const summary = candidate.summary || {};
  const counts = summary.counts || {};
  const restoreMode = candidate.restoreMode || "full";
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections
    : safeFullRestoreSections;
  const selectedSections = new Set(sections);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-neutral-400">Backup file</div>
        <div className="mt-1 break-words font-semibold text-accent">
          {candidate.file.name}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <div className="text-xs text-neutral-400">Exported</div>
          <div className="mt-1 text-sm font-medium text-neutral-200">
            {summary.exportedAt
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(summary.exportedAt))
              : "Unknown"}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <div className="text-xs text-neutral-400">Scheduled runs</div>
          <div className="mt-1 text-sm font-medium text-neutral-200">
            {summary.schedulerEnabled ? "Enabled in backup" : "Disabled in backup"}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-canvas/60 p-3">
        <div className="text-sm font-medium text-neutral-200">Restore mode</div>
        <SelectInput value={restoreMode} onChange={onRestoreModeChange}>
          <option value="full">Full restore</option>
          <option value="custom">Choose what to restore</option>
        </SelectInput>
        <p className="mt-2 text-xs leading-5 text-neutral-400">
          {restoreMode === "full"
            ? "Restores settings, exclusions, scheduler state, activity tracking, and history. Pending items are rebuilt from the current media server Leaving Soon folders when possible instead of importing old pending records."
            : "Choose one or more parts of the backup to restore."}
        </p>
        <p className="mt-1 text-xs leading-5 text-neutral-400">
          Scrubarr creates a safety backup before importing.
        </p>
        {restoreMode === "custom" && (
          <div className="mt-3 space-y-2">
            {backupRestoreSections.map((section) => (
              <label
                key={section.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                  section.warning
                    ? "border-amber-800/60 bg-amber-950/20"
                    : "border-line bg-canvas/70"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-yellow-400"
                  checked={selectedSections.has(section.value)}
                  onChange={() => onSectionToggle(section.value)}
                />
                <span>
                  <span className="block font-medium text-neutral-100">
                    {section.label}
                  </span>
                  <span
                    className={`mt-1 block text-xs leading-5 ${
                      section.warning ? "text-amber-100" : "text-neutral-400"
                    }`}
                  >
                    {section.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {restoreMode === "full" && (
          <div className="mt-3 flex flex-wrap gap-2">
            {backupRestoreSections
              .filter((section) => safeFullRestoreSections.includes(section.value))
              .map((section) => (
                <span
                  key={section.value}
                  className="rounded-full border border-line bg-canvas px-2.5 py-1 text-xs text-neutral-300"
                >
                  {section.label}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Active pending", counts.pending ?? 0],
          ["Deleted history", counts.deletedHistory ?? 0],
          ["Exclusions", counts.exclusions ?? 0],
          ["In progress", counts.inProgress ?? 0],
          ["Run log", counts.runLog ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-line bg-canvas/60 p-3">
            <div className="text-lg font-semibold text-neutral-100">{value}</div>
            <div className="mt-1 text-xs text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      {(summary.includesSecrets || summary.hasAuthSettings || summary.hasTelegramSettings) && (
        <div className="space-y-2">
          {summary.includesSecrets && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-sm leading-6 text-amber-100">
              This backup includes secrets and may replace API keys, Telegram
              token, and the auth password hash.
            </div>
          )}
          {summary.hasAuthSettings && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-sm leading-6 text-amber-100">
              This backup contains access-control settings. Restart Scrubarr if
              authentication settings change after import.
            </div>
          )}
          {summary.hasTelegramSettings && (
            <div className="rounded-lg border border-line bg-canvas/60 p-3 text-sm leading-6 text-neutral-300">
              Telegram settings are present in this backup.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GuidedUpdatePanel({
  updateInfo,
  targetTag,
  onTargetTagChange,
  prepareState,
  copyState,
  onPrepare,
  onCopy,
}) {
  const latest = updateInfo?.lastCheck?.latestVersion;
  const updateAvailable = updateInfo?.lastCheck?.updateAvailable === true;
  const effectiveTag =
    dockerTagFromVersion(targetTag) ||
    (updateAvailable ? dockerTagFromVersion(latest) : "");
  const currentTag = dockerTagFromVersion(updateInfo?.currentVersion);

  return (
    <div className="md:col-span-2 rounded-xl border border-line bg-canvas/60 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-100">
            Guided Docker update
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
            Scrubarr can prepare a safety backup and show the Docker commands,
            but it will not pull images, restart itself, or access the Docker
            socket. Run the commands from the Docker host after reviewing them.
            These commands work for Docker Compose installs on Windows and
            Linux.
          </p>
          {updateAvailable ? (
            <p className="mt-2 text-sm text-amber-100">
              Version {latest} is available.
            </p>
          ) : (
            <p className="mt-2 text-sm text-neutral-400">
              Run an update check or enter a release tag when you are ready to
              install a known version.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onPrepare}
          disabled={prepareState.state === "loading"}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60"
        >
          {prepareState.state === "loading" ? (
            <LoaderCircle className="animate-spin" size={16} />
          ) : (
            <ClipboardList size={16} />
          )}
          Create safety backup
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div>
          <label className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-200">
            Docker image to install
            <HelpTooltip text="Used only to generate Docker update commands. Enter the Scrubarr image tag you want to install, for example v0.1.9. Scrubarr does not pull or install this image automatically." />
          </label>
          <input
            className={`${inputClass} mt-1`}
            value={targetTag}
            placeholder={effectiveTag || "vX.X.X"}
            onChange={(event) => onTargetTagChange(event.target.value)}
          />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-neutral-200">
              Host commands
            </p>
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-neutral-200 hover:border-neutral-500"
            >
              <Copy size={14} />
              {copyState === "copied" ? "Copied" : "Copy commands"}
            </button>
          </div>
          <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-line bg-neutral-950 p-3 text-xs leading-5 text-neutral-200">
            {dockerUpdateCommandText(effectiveTag)}
          </pre>
        </div>
      </div>

      {currentTag && (
        <div className="mt-4 rounded-lg border border-line bg-panel/60 p-3 text-xs leading-5 text-neutral-400">
          Rollback note: if the update does not look right, set the image tag
          back to `ghcr.io/scrubarr/scrubarr:{currentTag}` and run the same
          pull/up commands. Restore the safety backup only if the newer version
          changed data that you need to undo.
        </div>
      )}

      {prepareState.message && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            prepareState.state === "error"
              ? "border-red-900/70 bg-red-950/30 text-red-200"
              : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
          }`}
        >
          {prepareState.message}
          {prepareState.fileName && (
            <div className="mt-1 break-words text-xs opacity-90">
              {prepareState.fileName}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState({ state: "idle", message: "" });
  const [tests, setTests] = useState({});
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateState, setUpdateState] = useState({ state: "idle", message: "" });
  const [updatePrepareState, setUpdatePrepareState] = useState({
    state: "idle",
    message: "",
  });
  const [updateTargetTag, setUpdateTargetTag] = useState("");
  const [updateCopyState, setUpdateCopyState] = useState("idle");
  const [telegramSendState, setTelegramSendState] = useState({
    state: "idle",
    message: "",
  });
  const [backupState, setBackupState] = useState({ state: "idle", message: "" });
  const [embyUsers, setEmbyUsers] = useState([]);
  const [embyUsersState, setEmbyUsersState] = useState({
    state: "idle",
    message: "",
  });
  const [mediaServerLibraries, setMediaServerLibraries] = useState([]);
  const [mediaServerLibrariesState, setMediaServerLibrariesState] = useState({
    state: "idle",
    message: "",
  });
  const [telegramConfirmOpen, setTelegramConfirmOpen] = useState(false);
  const [importCandidate, setImportCandidate] = useState(null);
  const [providerCandidate, setProviderCandidate] = useState(null);
  const [pendingProviderLock, setPendingProviderLock] = useState(false);
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [validationErrors, setValidationErrors] = useState([]);

  async function loadEmbyUsers() {
    setEmbyUsersState({ state: "loading", message: "" });
    try {
      const data = await fetchMediaServerUsers();
      setEmbyUsers(data.users || []);
      setEmbyUsersState({ state: "idle", message: "" });
    } catch (error) {
      setEmbyUsersState({ state: "error", message: error.message });
    }
  }

  async function loadMediaServerLibraries(draftSettings = settings) {
    setMediaServerLibrariesState({ state: "loading", message: "" });
    try {
      const data = await fetchMediaServerLibraries(draftSettings);
      setMediaServerLibraries(data.libraries || []);
      setMediaServerLibrariesState({ state: "idle", message: "" });
    } catch (error) {
      setMediaServerLibrariesState({ state: "error", message: error.message });
    }
  }

  useEffect(() => {
    Promise.all([
      requestJson("/api/settings"),
      requestJson("/api/settings/updates"),
    ])
      .then(([loadedSettings, loadedUpdateInfo]) => {
        setSettings(loadedSettings);
        setUpdateInfo(loadedUpdateInfo);
        setPendingProviderLock(false);
        setEmbyUsersState({ state: "loading", message: "" });
        fetchMediaServerUsers()
          .then((data) => {
            setEmbyUsers(data.users || []);
            setEmbyUsersState({ state: "idle", message: "" });
          })
          .catch((error) => {
            setEmbyUsersState({ state: "error", message: error.message });
          });
        setMediaServerLibrariesState({ state: "loading", message: "" });
        fetchMediaServerLibraries(loadedSettings)
          .then((data) => {
            setMediaServerLibraries(data.libraries || []);
            setMediaServerLibrariesState({ state: "idle", message: "" });
          })
          .catch((error) => {
            setMediaServerLibrariesState({
              state: "error",
              message: error.message,
            });
          });
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    const latest = updateInfo?.lastCheck?.latestVersion;
    if (!updateInfo?.lastCheck?.updateAvailable || !latest) return;
    setUpdateTargetTag((current) => current || dockerTagFromVersion(latest));
  }, [updateInfo?.lastCheck?.latestVersion, updateInfo?.lastCheck?.updateAvailable]);

  function set(path, value) {
    setSettings((current) => updateAtPath(current, path, value));
    setValidationErrors((current) => clearValidationForPath(current, path));
  }

  function setQueueRoot(mediaServerName, value) {
    setSettings((current) => {
      const next = structuredClone(current);
      next[mediaServerName].ToBeDeletedPaths = {
        ...(next[mediaServerName].ToBeDeletedPaths || {}),
        Movies: joinQueuePath(value, queueSubfolders.Movies),
        Series: joinQueuePath(value, queueSubfolders.Series),
      };
      return next;
    });
    setValidationErrors((current) =>
      clearValidationForPath(
        clearValidationForPath(
          current,
          `${mediaServerName}.ToBeDeletedPaths.Movies`,
        ),
        `${mediaServerName}.ToBeDeletedPaths.Series`,
      ),
    );
  }

  function chooseProvider(providerId) {
    const provider = mediaServerProviders.find((item) => item.id === providerId);
    if (!provider || settings.MediaServer?.Locked) return;
    setProviderCandidate(provider);
  }

  function confirmProviderChoice() {
    if (!providerCandidate) return;
    const selectedName = providerCandidate.name;
    setSettings((current) => {
      const withProvider = updateAtPath(
        current,
        "MediaServer.Provider",
        providerCandidate.id,
      );
      return updateAtPath(withProvider, "MediaServer.Locked", true);
    });
    setValidationErrors((current) =>
      clearValidationForPath(
        clearValidationForPath(current, "MediaServer.Provider"),
        "MediaServer.Locked",
      ),
    );
    setTests({});
    setSaveState({
      state: "success",
      message: `${selectedName} selected. Complete the ${selectedName} settings and save to continue.`,
    });
    setPendingProviderLock(true);
    setProviderCandidate(null);
  }

  function testResult(service) {
    return {
      result: tests[service],
      setResult: (result) =>
        setTests((current) => ({ ...current, [service]: result })),
    };
  }

  async function save(event) {
    event.preventDefault();
    setValidationErrors([]);
    const authPassword = settings.Auth?.Password || "";
    if (authPassword || authPasswordConfirm) {
      if (!authPassword) {
        setValidationErrors(["Auth.Password is required before confirming it"]);
        setSaveState({
          state: "error",
          message: "Enter the new basic auth password before confirming it.",
        });
        return;
      }
      if (authPassword !== authPasswordConfirm) {
        setValidationErrors(["Auth.PasswordConfirm must match Auth.Password"]);
        setSaveState({
          state: "error",
          message: "Basic auth password and confirmation do not match.",
        });
        return;
      }
    }
    setSaveState({ state: "loading", message: "Saving settings..." });
    try {
      const data = await requestJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(data.settings);
      setValidationErrors([]);
      setAuthPasswordConfirm("");
      setPendingProviderLock(false);
      loadEmbyUsers();
      loadMediaServerLibraries(data.settings);
      setSaveState({ state: "success", message: "Settings saved." });
    } catch (error) {
      setValidationErrors(validationDetails(error));
      setSaveState({ state: "error", message: error.message });
    }
  }

  async function checkUpdates() {
    setUpdateState({ state: "loading", message: "Checking..." });
    try {
      const data = await requestJson("/api/settings/updates/check", {
        method: "POST",
      });
      const refreshed = await requestJson("/api/settings/updates").catch(() => ({}));
      setUpdateInfo((current) => ({
        ...current,
        ...refreshed,
        ...data,
        lastCheck: data.checkedAt
          ? data
          : refreshed.lastCheck || data.lastCheck || current?.lastCheck,
        updateCheckRunning: false,
      }));
      setUpdateState({
        state: "success",
        message: data.configured
          ? data.updateAvailable
            ? `Version ${data.latestVersion} is available.`
            : "You are up to date."
          : data.message,
      });
      window.dispatchEvent(new Event("scrubarr:update-checked"));
    } catch (error) {
      setUpdateState({ state: "error", message: error.message });
    }
  }

  async function prepareGuidedUpdate() {
    setUpdatePrepareState({
      state: "loading",
      message: "Creating safety backup...",
    });
    try {
      const data = await requestJson("/api/backup/pre-update", {
        method: "POST",
      });
      setUpdatePrepareState({
        state: "success",
        message:
          "Safety backup created. Review the Docker commands before updating.",
        fileName: data.fileName,
      });
    } catch (error) {
      setUpdatePrepareState({ state: "error", message: error.message });
    }
  }

  async function copyGuidedUpdateCommands() {
    const latest = updateInfo?.lastCheck?.updateAvailable
      ? updateInfo.lastCheck.latestVersion
      : "";
    const tag = updateTargetTag || dockerTagFromVersion(latest);
    try {
      await navigator.clipboard.writeText(dockerUpdateCommandText(tag));
      setUpdateCopyState("copied");
      window.setTimeout(() => setUpdateCopyState("idle"), 2000);
    } catch {
      setUpdateCopyState("error");
      window.setTimeout(() => setUpdateCopyState("idle"), 2000);
    }
  }

  async function sendTelegramTest() {
    setTelegramConfirmOpen(false);
    setTelegramSendState({ state: "loading", message: "Sending test message..." });
    try {
      const data = await requestJson("/api/telegram/test-message", {
        method: "POST",
        body: JSON.stringify(settings),
      });
      setTelegramSendState({ state: "success", message: data.message });
    } catch (error) {
      setTelegramSendState({ state: "error", message: error.message });
    }
  }

  async function exportBackup(includeSecrets) {
    setBackupState({ state: "loading", message: "Preparing backup..." });
    try {
      const response = await fetch(
        `/api/backup/export?includeSecrets=${includeSecrets ? "true" : "false"}`,
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Backup export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scrubarr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupState({
        state: "success",
        message: includeSecrets
          ? "Backup exported with secrets."
          : "Backup exported without secrets.",
      });
    } catch (error) {
      setBackupState({ state: "error", message: error.message });
    }
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupState({ state: "loading", message: "Reading backup..." });
    try {
      const backup = JSON.parse(await file.text());
      const summary = await requestJson("/api/backup/summary", {
        method: "POST",
        body: JSON.stringify(backup),
      });
      setImportCandidate({
        file,
        backup,
        summary: summary.summary,
        restoreMode: "full",
        sections: [...safeFullRestoreSections],
      });
      setBackupState({ state: "idle", message: "" });
    } catch (error) {
      setImportCandidate(null);
      setBackupState({ state: "error", message: error.message });
    }
  }

  async function confirmImportBackup() {
    const candidate = importCandidate;
    if (!candidate) return;
    const sections = Array.isArray(candidate.sections) ? candidate.sections : [];
    if (sections.length === 0) {
      setBackupState({
        state: "error",
        message: "Choose at least one restore section before importing.",
      });
      return;
    }
    setImportCandidate(null);
    setBackupState({ state: "loading", message: "Importing backup..." });
    try {
      const data = await requestJson("/api/backup/import", {
        method: "POST",
        body: JSON.stringify({
          backup: candidate.backup,
          mode: candidate.restoreMode || "custom",
          sections,
        }),
      });
      const [loadedSettings, loadedUpdateInfo] = await Promise.all([
        requestJson("/api/settings"),
        requestJson("/api/settings/updates"),
      ]);
      setSettings(loadedSettings);
      setUpdateInfo(loadedUpdateInfo);
      setPendingProviderLock(false);
      loadEmbyUsers();
      setBackupState({ state: "success", message: data.message });
    } catch (error) {
      setBackupState({ state: "error", message: error.message });
    }
  }

  if (loadError) return <StatePanel tone="error">{loadError}</StatePanel>;
  if (!settings) return <StatePanel>Loading settings...</StatePanel>;

  const fieldError = (paths) => validationMessageFor(validationErrors, paths);
  const mediaProvider =
    settings.MediaServer?.Provider === "jellyfin" ? "jellyfin" : "emby";
  const mediaServerName = mediaProvider === "jellyfin" ? "Jellyfin" : "Emby";
  const mediaServerLogo = mediaProvider === "jellyfin" ? jellyfinLogo : embyLogo;
  const mediaServerConfig = settings[mediaServerName] || {};
  const mediaServerLocked = settings.MediaServer?.Locked === true;
  const mediaServerDescription = pendingProviderLock
    ? `This Scrubarr install will be locked to ${mediaServerName} once you configure and save these settings. Add the ${mediaServerName} server URL, API information, libraries, and users Scrubarr should use and then save.`
    : `Add the ${mediaServerName} server URL, API information, libraries, and users Scrubarr should use.`;

  return (
    <form className="space-y-6" onSubmit={save} noValidate>
      <ConfirmDialog
        open={telegramConfirmOpen}
        icon={<MessageCircle size={22} />}
        title="Send Telegram test?"
        message="Scrubarr will send one test message. No scan, queue change, or deletion will run."
        confirmLabel="Send test message"
        onCancel={() => setTelegramConfirmOpen(false)}
        onConfirm={sendTelegramTest}
        detail={
          <>
            <div className="text-sm text-neutral-400">Chat ID</div>
            <div className="mt-1 font-semibold text-accent">
              {settings.Telegram.ChatID || "Not configured"}
            </div>
          </>
        }
      />
      <ConfirmDialog
        open={Boolean(importCandidate)}
        icon={<Upload size={22} />}
        title="Import backup?"
        message="Review this backup summary before replacing current Scrubarr data."
        tone="danger"
        confirmLabel="Import backup"
        onCancel={() => setImportCandidate(null)}
        onConfirm={confirmImportBackup}
        detail={
          importCandidate && (
            <BackupImportDetail
              candidate={importCandidate}
              onRestoreModeChange={(restoreMode) =>
                setImportCandidate((current) =>
                  current
                    ? {
                        ...current,
                        restoreMode,
                        sections:
                          restoreMode === "full"
                            ? [...safeFullRestoreSections]
                            : current.sections || [...safeFullRestoreSections],
                      }
                    : current,
                )
              }
              onSectionToggle={(section) =>
                setImportCandidate((current) => {
                  if (!current) return current;
                  const selected = new Set(current.sections || []);
                  if (selected.has(section)) selected.delete(section);
                  else selected.add(section);
                  return {
                    ...current,
                    restoreMode: "custom",
                    sections: [...selected],
                  };
                })
              }
            />
          )
        }
      />
      <ConfirmDialog
        open={Boolean(providerCandidate)}
        icon={
          providerCandidate ? (
            <img
              src={providerCandidate.logo}
              alt=""
              className="h-6 w-6"
              aria-hidden="true"
            />
          ) : null
        }
        title={`Configure Scrubarr for ${providerCandidate?.name || "this media server"}?`}
        message={`Are you sure you want to configure Scrubarr for ${providerCandidate?.name || "this media server"}? This selection cannot be undone and this Scrubarr installation will be locked to this service.`}
        confirmLabel={`Yes, use ${providerCandidate?.name || "this service"}`}
        onCancel={() => setProviderCandidate(null)}
        onConfirm={confirmProviderChoice}
      />

      <section>
        <p className="text-sm font-medium text-accent">Configuration</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 max-w-3xl text-neutral-400">
          Manage connections, notifications, storage, backups, and access for
          Scrubarr.
        </p>
      </section>

      {!mediaServerLocked && (
        <SettingsSection
          title="Media server"
          icon={<Info size={22} />}
          description="Choose whether this Scrubarr install should use Emby or Jellyfin. You will be asked to confirm before the install is locked."
        >
          <div className="grid gap-3 md:col-span-2 sm:grid-cols-2">
            {mediaServerProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => chooseProvider(provider.id)}
                className="flex min-h-24 items-start gap-4 rounded-xl border border-line bg-canvas p-4 text-left transition hover:border-accent hover:bg-accent/10"
              >
                <img src={provider.logo} alt="" className="h-9 w-9 shrink-0" />
                <span>
                  <span className="flex items-center gap-2 text-base font-semibold text-white">
                    {provider.name}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-neutral-400">
                    {provider.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </SettingsSection>
      )}

      {mediaServerLocked && (
        <SettingsSection
          title={mediaServerName}
          logo={mediaServerLogo}
          description={mediaServerDescription}
          action={
            <ServiceTestButton
              service={mediaProvider}
              settings={settings}
              onSuccess={() => {
                loadEmbyUsers();
                loadMediaServerLibraries();
              }}
              {...testResult(mediaProvider)}
            />
          }
        >
        <Field
          label="Server URL"
          help={serverUrlHelp[mediaServerName]}
          error={fieldError(`${mediaServerName}.ServerUrl`)}
        >
          <TextInput
            value={mediaServerConfig.ServerUrl || ""}
            onChange={(value) => set(`${mediaServerName}.ServerUrl`, value)}
          />
          <LocalhostUrlWarning value={mediaServerConfig.ServerUrl} />
        </Field>
        <Field
          label="API key"
          help={`Your ${mediaServerName} API key. It is stored server-side and is not returned to the browser after saving.`}
          error={fieldError(`${mediaServerName}.ApiKey`)}
        >
          <SecretInput
            value={mediaServerConfig.ApiKey}
            configured={mediaServerConfig.ApiKeyConfigured}
            onChange={(value) => set(`${mediaServerName}.ApiKey`, value)}
          />
        </Field>
        <SearchLibrariesPicker
          providerLabel={mediaServerName}
          libraries={mediaServerLibraries}
          state={mediaServerLibrariesState}
          selectedNames={mediaServerConfig.SearchLibraries || []}
          onChange={(value) => set(`${mediaServerName}.SearchLibraries`, value)}
          onRefresh={() => loadMediaServerLibraries()}
          error={fieldError(`${mediaServerName}.SearchLibraries`)}
        />
        <EmbyUsersPicker
          providerLabel={mediaServerName}
          users={embyUsers}
          state={embyUsersState}
          selectedIds={mediaServerConfig.UserIds || []}
          onChange={(value) => set(`${mediaServerName}.UserIds`, value)}
          onRefresh={loadEmbyUsers}
          error={fieldError(`${mediaServerName}.UserIds`)}
        />
        <Toggle
          label={`Create ${mediaServerName} deletion libraries`}
          help={`When enabled, Scrubarr can manage Leaving Soon libraries in ${mediaServerName} for pending items.`}
          checked={mediaServerConfig.CreateDeletionLibraries}
          onChange={(value) => set(`${mediaServerName}.CreateDeletionLibraries`, value)}
          error={fieldError(`${mediaServerName}.CreateDeletionLibraries`)}
        />
        <div />
        <Field
          label="Movie deletion library name"
          help={`The ${mediaServerName} library name to use for movies that are pending deletion. This library will be shown to your ${mediaServerName} users.`}
          error={fieldError(`${mediaServerName}.DeletionLibraries.Movies`)}
        >
          <TextInput
            value={mediaServerConfig.DeletionLibraries?.Movies || ""}
            onChange={(value) => set(`${mediaServerName}.DeletionLibraries.Movies`, value)}
          />
        </Field>
        <Field
          label="Series deletion library name"
          help={`The ${mediaServerName} library name to use for series that are pending deletion. This library will be shown to your ${mediaServerName} users.`}
          error={fieldError(`${mediaServerName}.DeletionLibraries.Series`)}
        >
          <TextInput
            value={mediaServerConfig.DeletionLibraries?.Series || ""}
            onChange={(value) => set(`${mediaServerName}.DeletionLibraries.Series`, value)}
          />
        </Field>
        <Field
          label="Leaving Soon queue root path"
          help={`Choose the parent folder ${mediaServerName} will scan for Scrubarr's Leaving Soon links. Scrubarr creates separate movie and show subfolders inside this folder.`}
          error={
            fieldError(`${mediaServerName}.ToBeDeletedPaths.Movies`) ||
            fieldError(`${mediaServerName}.ToBeDeletedPaths.Series`)
          }
        >
          <TextInput
            value={queueRootFromPaths(mediaServerConfig.ToBeDeletedPaths)}
            onChange={(value) => setQueueRoot(mediaServerName, value)}
          />
          <div className="mt-2 rounded-lg border border-line bg-canvas/50 p-3 text-xs leading-5 text-neutral-400">
            <div className="font-medium text-neutral-300">Scrubarr-managed subfolders</div>
            <div className="mt-1 break-words">
              Movies: {mediaServerConfig.ToBeDeletedPaths?.Movies || "Not set"}
            </div>
            <div className="break-words">
              Shows: {mediaServerConfig.ToBeDeletedPaths?.Series || "Not set"}
            </div>
          </div>
        </Field>
        <div />
        </SettingsSection>
      )}

      {["Radarr", "Sonarr"].map((name) => {
        const key = name.toLowerCase();
        const config = settings.Arrs[name];
        return (
          <SettingsSection
            key={name}
            title={name}
            logo={name === "Radarr" ? radarrLogo : sonarrLogo}
            description={
              name === "Radarr"
                ? "Used to match movies and request movie deletions."
                : "Used to match series and request series deletions."
            }
            action={
              <ServiceTestButton service={key} settings={settings} {...testResult(key)} />
            }
          >
            <Toggle
              label={`Enable ${name}`}
              help={`Allow Scrubarr to use ${name} for matching and cleanup handling.`}
              checked={config.Enabled}
              onChange={(value) => set(`Arrs.${name}.Enabled`, value)}
              error={fieldError(`Arrs.${name}.Enabled`)}
            />
            <div />
            <Field
              label="Server URL"
              help={serverUrlHelp[name]}
              error={fieldError(`Arrs.${name}.Url`)}
            >
              <TextInput
                value={config.Url}
                onChange={(value) => set(`Arrs.${name}.Url`, value)}
              />
              <LocalhostUrlWarning value={config.Url} />
            </Field>
            <Field
              label="API key"
              help={`Your ${name} API key. It stays server-side and is masked after saving.`}
              error={fieldError(`Arrs.${name}.ApiKey`)}
            >
              <SecretInput
                value={config.ApiKey}
                configured={config.ApiKeyConfigured}
                onChange={(value) => set(`Arrs.${name}.ApiKey`, value)}
              />
            </Field>
          </SettingsSection>
        );
      })}

      <SettingsSection
        title="Telegram"
        logo={telegramLogo}
        description="Send status and cleanup notifications to Telegram."
        action={
          <div className="flex flex-wrap items-start justify-start gap-3">
            <ServiceTestButton
              service="telegram"
              settings={settings}
              {...testResult("telegram")}
            />
            <button
              type="button"
              onClick={() => setTelegramConfirmOpen(true)}
              disabled={telegramSendState.state === "loading"}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60"
            >
              {telegramSendState.state === "loading" ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <MessageCircle size={16} />
              )}
              Send test message
            </button>
          </div>
        }
      >
        <Toggle
          label="Enable Telegram notifications"
          help="Allow Scrubarr to send Telegram messages. Use Send test message to confirm delivery."
          checked={settings.Telegram.Enabled}
          onChange={(value) => set("Telegram.Enabled", value)}
          error={fieldError("Telegram.Enabled")}
        />
        <div />
        <Field
          label="Bot token"
          help="Telegram bot token from BotFather. It stays server-side and is masked after saving."
          error={fieldError("Telegram.BotToken")}
        >
          <SecretInput
            value={settings.Telegram.BotToken}
            configured={settings.Telegram.BotTokenConfigured}
            onChange={(value) => set("Telegram.BotToken", value)}
          />
        </Field>
        <Field
          label="Chat ID"
          help="Telegram chat, group, or channel ID where Scrubarr should send notifications."
          error={fieldError("Telegram.ChatID")}
        >
          <TextInput
            value={settings.Telegram.ChatID}
            onChange={(value) => set("Telegram.ChatID", value)}
          />
        </Field>
        <Field
          label="Notifications"
          help="Choose how often Scrubarr sends Telegram messages between the first pending summary and the final deletion report. Critical alerts are always sent when Telegram is enabled."
          error={fieldError("Telegram.NotificationPolicy")}
        >
          <SelectInput
            value={settings.Telegram.NotificationPolicy || "standard"}
            onChange={(value) => set("Telegram.NotificationPolicy", value)}
          >
            {telegramNotificationPolicies.map((policy) => (
              <option key={policy.value} value={policy.value}>
                {policy.label}
              </option>
            ))}
          </SelectInput>
          <div className="mt-2 space-y-2 text-xs leading-5 text-neutral-400">
            <p>
              {
                telegramNotificationPolicies.find(
                  (policy) =>
                    policy.value ===
                    (settings.Telegram.NotificationPolicy || "standard"),
                )?.description
              }
            </p>
            <p className="border-t border-line/60 pt-2 text-neutral-500">
              First-day summaries, deletion reports, and critical alerts are always
              sent when Telegram is enabled.
            </p>
          </div>
        </Field>
        {telegramSendState.message && (
          <div
            className={`md:col-span-2 rounded-lg border p-3 text-sm ${
              telegramSendState.state === "error"
                ? "border-red-900/70 bg-red-950/30 text-red-200"
                : "border-emerald-900/60 bg-emerald-950/30 text-emerald-200"
            }`}
          >
            {telegramSendState.message}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Access control"
        icon={<KeyRound size={19} />}
        description="Basic authentication is available for simple local protection, but it is not recommended as your main security layer. For exposed installs, use a more robust external service such as a reverse proxy, VPN, SSO, or another dedicated authentication provider."
      >
        <Toggle
          label="Enable basic authentication"
          help="When enabled, browsers must provide this username and password before accessing Scrubarr. Basic auth is simple and convenient, but external authentication is safer for internet-facing access."
          warning={
            settings.Auth.Enabled
              ? "Keep these details somewhere safe. You can recover by disabling auth in the config file or environment before restarting."
              : "Recommended: leave disabled when access is handled by an external authentication service."
          }
          checked={settings.Auth.Enabled}
          onChange={(value) => set("Auth.Enabled", value)}
          error={fieldError("Auth.Enabled")}
        />
        <div />
        <Field
          label="Username"
          help="Username required by the Scrubarr login page."
          error={fieldError("Auth.Username")}
        >
          <TextInput
            value={settings.Auth.Username}
            onChange={(value) => set("Auth.Username", value)}
          />
        </Field>
        <Field
          label="Password"
          help="Password required by the Scrubarr login page. Leave blank to keep the saved password."
          error={fieldError("Auth.Password")}
        >
          <SecretInput
            value={settings.Auth.Password}
            configured={settings.Auth.PasswordConfigured}
            onChange={(value) => set("Auth.Password", value)}
          />
        </Field>
        <Field
          label="Confirm password"
          help="Re-enter a new password before saving. Leave blank when keeping the saved password."
          error={fieldError("Auth.PasswordConfirm")}
        >
          <SecretInput
            value={authPasswordConfirm}
            configured={false}
            onChange={(value) => {
              setAuthPasswordConfirm(value);
              setValidationErrors((current) =>
                clearValidationForPath(current, "Auth.PasswordConfirm"),
              );
            }}
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        title="Backup and restore"
        icon={<ClipboardList size={19} />}
        description="Export or import Scrubarr settings and local tracking data."
      >
        <div className="md:col-span-2 rounded-xl border border-line bg-canvas/60 p-4 text-sm leading-6 text-neutral-300">
          <p>
            Export creates a JSON backup of Scrubarr settings and local tracking
            data, such as exclusions, pending items, scheduler state, and run
            history.
          </p>
          <p className="mt-2">
            Import lets you review a backup file and choose which parts to
            restore, which is useful for recovery or moving Scrubarr to another
            install.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-200">Export backup</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportBackup(false)}
              disabled={backupState.state === "loading"}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-neutral-500 disabled:opacity-60"
            >
              <Download size={16} />
              Export without secrets
            </button>
            <button
              type="button"
              onClick={() => exportBackup(true)}
              disabled={backupState.state === "loading"}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-700/70 px-3 py-2 text-sm font-medium text-amber-100 hover:border-amber-500 disabled:opacity-60"
            >
              <Download size={16} />
              Export with secrets
            </button>
          </div>
          <p className="text-xs text-neutral-400">
            Export with secrets includes API keys, Telegram token, and auth password hash.
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-200">Import backup</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-neutral-500">
            <Upload size={16} />
            Choose backup file
            <input
              className="hidden"
              type="file"
              accept="application/json,.json"
              onChange={importBackup}
            />
          </label>
          <p className="text-xs text-neutral-400">
            Choose a backup file, review the summary, then pick what to restore.
          </p>
        </div>
        {backupState.message && (
          <div
            className={`md:col-span-2 rounded-lg border p-3 text-sm ${
              backupState.state === "error"
                ? "border-red-900/70 bg-red-950/30 text-red-200"
                : "border-line bg-canvas/60 text-neutral-300"
            }`}
          >
            {backupState.message}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="updates"
        title="About and updates"
        icon={<Info size={19} />}
        description="Check the installed version and look for available updates."
        action={
          <div className="flex max-w-full flex-col items-start gap-2">
            <button
              type="button"
              onClick={checkUpdates}
              disabled={updateState.state === "loading"}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-neutral-500 disabled:opacity-60"
            >
              <RefreshCw
                size={16}
                className={updateState.state === "loading" ? "animate-spin" : ""}
              />
              Check for updates
            </button>
            {updateState.message && isUpToDateMessage(updateState.message) ? (
              <UpdateSuccessPill>{updateState.message}</UpdateSuccessPill>
            ) : updateState.message ? (
              <div
                className={`max-w-full rounded-lg border px-3 py-2 text-sm ${
                  updateState.state === "error"
                    ? "border-red-900/70 bg-red-950/30 text-red-200"
                    : "border-line bg-canvas/60 text-neutral-300"
                }`}
              >
                {updateState.message}
              </div>
            ) : null}
          </div>
        }
      >
        <div className="md:col-span-2">
          <p className="text-sm text-neutral-400">Current version</p>
          <p className="mt-1 text-xl font-semibold">{updateInfo?.currentVersion}</p>
        </div>
        <div className="w-full max-w-md">
          <Toggle
            label="Automatic update checks"
            help="When enabled, Scrubarr checks for updates once a day if update checking has been configured for this install. It never installs updates or restarts the app automatically."
            warning=""
            checked={settings.Updates.AutoCheckEnabled}
            onChange={(value) => set("Updates.AutoCheckEnabled", value)}
            error={fieldError("Updates.AutoCheckEnabled")}
          />
        </div>
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <p className="text-sm text-neutral-400">Latest available</p>
          <p className="mt-1 text-sm font-medium text-neutral-200">
            {updateInfo?.lastCheck?.latestVersion || "Unknown"}
          </p>
          {updateInfo?.lastCheck?.releaseUrl && (
            <a
              className="mt-1 inline-flex text-xs text-accent hover:text-yellow-300"
              href={updateInfo.lastCheck.releaseUrl}
              target="_blank"
              rel="noreferrer"
            >
              View release
            </a>
          )}
        </div>
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <p className="text-sm text-neutral-400">Last update check</p>
          <p className="mt-1 text-sm font-medium text-neutral-200">
            {formatDateTime(updateInfo?.lastCheck?.checkedAt)}
          </p>
          {updateInfo?.lastCheck?.message &&
          !updateInfo.lastCheck.updateAvailable &&
          updateInfo.lastCheck.status !== "failed" &&
          isUpToDateMessage(updateInfo.lastCheck.message) ? (
            <div className="mt-2">
              <UpdateSuccessPill size="xs">
                {updateInfo.lastCheck.message}
              </UpdateSuccessPill>
            </div>
          ) : updateInfo?.lastCheck?.message ? (
            <p
              className={`mt-1 text-xs leading-5 ${
                updateInfo.lastCheck.status === "failed"
                  ? "text-red-300"
                  : updateInfo.lastCheck.updateAvailable
                    ? "text-amber-200"
                    : "text-neutral-400"
              }`}
            >
              {updateInfo.lastCheck.message}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg border border-line bg-canvas/60 p-3">
          <p className="text-sm text-neutral-400">Next automatic check</p>
          <p className="mt-1 text-sm font-medium text-neutral-200">
            {settings.Updates.AutoCheckEnabled && updateInfo?.updateSourceConfigured
              ? formatDateTime(updateInfo?.nextCheck)
              : "Not scheduled"}
          </p>
        </div>
        <GuidedUpdatePanel
          updateInfo={updateInfo}
          targetTag={updateTargetTag}
          onTargetTagChange={setUpdateTargetTag}
          prepareState={updatePrepareState}
          copyState={updateCopyState}
          onPrepare={prepareGuidedUpdate}
          onCopy={copyGuidedUpdateCommands}
        />
      </SettingsSection>

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
          Save settings
        </button>
      </div>
    </form>
  );
}
