import fs from "node:fs/promises";
import path from "node:path";
import { currentManifestEntries } from "./deletion-library-sync.js";
import { fetchExternal, ExternalServiceError } from "./external-error.js";
import { mediaServerConfig } from "./media-server.js";
import { activePendingItems } from "./pending-state.js";

const ARR_TIMEOUT_MS = 5000;

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function pendingItemKey(item) {
  return `${item?.Type || "Media"}|${String(item?.ItemId || "")}`;
}

function compactPendingItem(item) {
  return {
    key: pendingItemKey(item),
    ItemId: String(item.ItemId),
    Title: item.Title || "Untitled media",
    Type: item.Type || "Media",
    Year: item.Year || null,
    Arr: item.Arr || null,
    ArrId: Number.isInteger(item.ArrId) ? item.ArrId : null,
    HasPrimaryImage: Boolean(item.HasPrimaryImage),
  };
}

function addIssue(map, item, issue) {
  const key = pendingItemKey(item);
  const existing = map.get(key) || {
    ...compactPendingItem(item),
    issues: [],
  };
  existing.issues.push(issue);
  map.set(key, existing);
}

function pathFamily(value) {
  const text = String(value || "");
  if (/^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text)) return "windows";
  if (text.startsWith("/")) return "posix";
  return "unknown";
}

function canCheckPath(value) {
  const family = pathFamily(value);
  if (family === "windows") return process.platform === "win32";
  if (family === "posix") return process.platform !== "win32";
  return false;
}

async function sourcePathMissing(target) {
  if (!target || !canCheckPath(target)) {
    return { checked: false, missing: false };
  }

  const current = await fs.lstat(target).catch(() => null);
  if (current) return { checked: true, missing: false };

  // Avoid false positives when Scrubarr cannot see the media mount at all.
  const parent = await fs.lstat(path.dirname(target)).catch(() => null);
  return { checked: Boolean(parent), missing: Boolean(parent) };
}

function arrConfigFor(settings = {}, item) {
  if (item.Type === "Movie") {
    return {
      service: "Radarr",
      config: settings.Arrs?.Radarr,
      endpoint: `/api/v3/movie/${item.ArrId}`,
    };
  }
  if (item.Type === "Series") {
    return {
      service: "Sonarr",
      config: settings.Arrs?.Sonarr,
      endpoint: `/api/v3/series/${item.ArrId}`,
    };
  }
  return null;
}

async function checkArrRecord(settings, item) {
  const arr = arrConfigFor(settings, item);
  if (!arr?.config?.Enabled) return { checked: false };
  if (!arr.config.Url || !arr.config.ApiKey) return { checked: false };
  if (!Number.isInteger(item.ArrId)) {
    return {
      checked: true,
      missing: true,
      issue: {
        code: "missing_arr_identity",
        message: `${arr.service} ID is missing, so Scrubarr may not be able to delete this item through ${arr.service}.`,
      },
    };
  }

  try {
    await fetchExternal({
      service: arr.service,
      operation: "check pending item",
      url: new URL(`${trimUrl(arr.config.Url)}${arr.endpoint}`),
      timeoutMs: ARR_TIMEOUT_MS,
      options: {
        headers: { "X-Api-Key": arr.config.ApiKey },
      },
    });
    return { checked: true, missing: false };
  } catch (error) {
    if (error instanceof ExternalServiceError && error.status === 404) {
      return {
        checked: true,
        missing: true,
        issue: {
          code: "missing_arr_record",
          message: `${arr.service} no longer has a matching record for this item.`,
        },
      };
    }
    return {
      checked: false,
      warning: `${arr.service} could not be checked: ${error.message}`,
    };
  }
}

export async function pendingIntegrityReport({
  pending = [],
  settings,
  manifestDirectory,
} = {}) {
  const active = activePendingItems(pending);
  const issuesByKey = new Map();
  const warnings = [];
  const checks = {
    queue: { enabled: false, checked: false, found: 0 },
    source: { checked: 0, skipped: 0 },
    arr: { checked: 0, skipped: 0 },
  };

  let entries = [];
  const activeConfig = mediaServerConfig(settings || {});
  if (activeConfig.CreateDeletionLibraries === true) {
    checks.queue.enabled = true;
    try {
      entries = await currentManifestEntries({ settings, manifestDirectory });
      checks.queue.checked = true;
      checks.queue.found = entries.length;
    } catch (error) {
      warnings.push(`Leaving Soon queue folders could not be checked: ${error.message}`);
    }
  }

  const entriesByKey = new Map(
    entries.map((entry) => [
      pendingItemKey({ Type: entry.type, ItemId: entry.itemId }),
      entry,
    ]),
  );

  if (checks.queue.checked) {
    for (const item of active) {
      if (entriesByKey.has(pendingItemKey(item))) continue;
      addIssue(issuesByKey, item, {
        code: "missing_queue_entry",
        message: "No managed Leaving Soon queue entry was found for this pending item.",
      });
    }
  }

  await Promise.all(active.map(async (item) => {
    const entry = entriesByKey.get(pendingItemKey(item));
    const target = entry?.entry?.target || null;
    const sourceCheck = await sourcePathMissing(target);
    if (!sourceCheck.checked) {
      checks.source.skipped += 1;
    } else {
      checks.source.checked += 1;
      if (sourceCheck.missing) {
        addIssue(issuesByKey, item, {
          code: "missing_source_file",
          message: "The source media path referenced by the Leaving Soon item could not be found.",
        });
      }
    }

    const arrCheck = await checkArrRecord(settings, item);
    if (!arrCheck.checked) {
      checks.arr.skipped += 1;
      if (arrCheck.warning) warnings.push(arrCheck.warning);
    } else {
      checks.arr.checked += 1;
      if (arrCheck.missing) addIssue(issuesByKey, item, arrCheck.issue);
    }
  }));

  const items = [...issuesByKey.values()].sort((left, right) =>
    String(left.Title).localeCompare(String(right.Title)) ||
    String(left.Type).localeCompare(String(right.Type)),
  );

  return {
    ok: items.length === 0,
    checkedAt: new Date().toISOString(),
    pendingTotal: active.length,
    staleCount: items.length,
    issueCount: items.reduce((total, item) => total + item.issues.length, 0),
    items,
    warnings,
    checks,
    message:
      items.length > 0
        ? `${items.length} pending item(s) need review.`
        : "Pending queue integrity looks good.",
  };
}
