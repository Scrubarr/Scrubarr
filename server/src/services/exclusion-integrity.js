import fs from "node:fs/promises";
import { fetchExternal, ExternalServiceError } from "./external-error.js";
import { validateDirectDeletionPath } from "./direct-delete-guard.js";
import {
  getMediaServerItemsByIds,
  mediaServerConfigured,
  mediaServerLabel,
  searchMediaServer,
} from "./media-server.js";
import { isSameExclusion } from "./exclusions.js";

const ARR_TIMEOUT_MS = 5000;
const MEDIA_SERVER_ID_BATCH_SIZE = 100;
const LOOKUP_CONCURRENCY = 4;

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function mapWithConcurrency(items, callback, limit = LOOKUP_CONCURRENCY) {
  const queue = [...items];
  const results = [];
  const workers = Array.from(
    { length: Math.min(Math.max(limit, 1), queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        results.push(await callback(item));
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function batch(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function exclusionItemKey(item) {
  if (item?.ItemId) return `${item?.Type || "Media"}|${String(item.ItemId)}`;
  if (item?.Arr && Number.isInteger(item.ArrId)) {
    return `${item.Arr}|${item.ArrId}`;
  }
  return `${item?.Type || "Media"}|${String(item?.Title || "Untitled media").toLowerCase()}`;
}

function compactExclusion(item) {
  return {
    key: exclusionItemKey(item),
    ItemId: item.ItemId ? String(item.ItemId) : "",
    Title: item.Title || "Untitled media",
    Type: item.Type || "Media",
    Year: item.Year || null,
    Arr: item.Arr || null,
    ArrId: Number.isInteger(item.ArrId) ? item.ArrId : null,
    HasPrimaryImage: Boolean(item.HasPrimaryImage),
  };
}

function addEvidence(map, item, evidence) {
  const key = exclusionItemKey(item);
  const existing = map.get(key) || {
    ...compactExclusion(item),
    evidence: [],
  };
  existing.evidence.push(evidence);
  map.set(key, existing);
}

function issueFromEvidence(evidence) {
  return {
    code: evidence.code,
    message: evidence.message,
  };
}

function sourcePathCheckSettings(settings, target) {
  if (settings?.CleanupRules?.FallbackFileDeletion !== true) {
    return { ok: false, reason: "Direct fallback is disabled." };
  }
  const allowedRoots = settings?.CleanupRules?.DirectFileDeletionAllowedRoots;
  const validation = validateDirectDeletionPath({
    targetPath: target,
    allowedRoots,
  });
  if (!validation.ok) return { ok: false, reason: validation.message };
  return { ok: true, path: validation.path };
}

export async function sourcePathStatus(settings, target) {
  if (!target) return { checked: false, missing: false };
  const validation = sourcePathCheckSettings(settings, target);
  if (!validation.ok) {
    return { checked: false, missing: false, reason: validation.reason };
  }

  try {
    await fs.lstat(validation.path);
    return { checked: true, missing: false };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return { checked: true, missing: true };
    }
    return {
      checked: false,
      missing: false,
      warning: `Source path could not be checked: ${error.message || "filesystem access failed"}`,
    };
  }
}

function arrConfigFor(settings = {}, item) {
  const arrName =
    item.Arr ||
    (item.Type === "Movie" ? "Radarr" : item.Type === "Series" ? "Sonarr" : "");
  if (arrName === "Radarr") {
    return {
      service: "Radarr",
      config: settings.Arrs?.Radarr,
      endpoint: `/api/v3/movie/${item.ArrId}`,
    };
  }
  if (arrName === "Sonarr") {
    return {
      service: "Sonarr",
      config: settings.Arrs?.Sonarr,
      endpoint: `/api/v3/series/${item.ArrId}`,
    };
  }
  return null;
}

export async function checkArrRecord(settings, item) {
  if (!Number.isInteger(item.ArrId)) return { checked: false };
  const arr = arrConfigFor(settings, item);
  if (!arr?.config?.Enabled || !arr.config.Url || !arr.config.ApiKey) {
    return { checked: false };
  }

  try {
    await fetchExternal({
      service: arr.service,
      operation: "check excluded item",
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
          message: `${arr.service} no longer has a matching record for this exclusion.`,
        },
      };
    }
    return {
      checked: false,
      warning: `${arr.service} could not be checked for exclusions: ${error.message}`,
    };
  }
}

export async function defaultMediaServerLookup(settings, exclusions) {
  if (!mediaServerConfigured(settings)) {
    return {
      checked: false,
      warning: `${mediaServerLabel(settings)} is not fully configured, so exclusions could not be checked against the media server.`,
      matches: new Map(),
    };
  }

  const matches = new Map();
  const ids = exclusions
    .map((item) => String(item.ItemId || ""))
    .filter(Boolean);
  const directMatches = (
    await Promise.all(
      batch(ids, MEDIA_SERVER_ID_BATCH_SIZE).map((idsBatch) =>
        getMediaServerItemsByIds(settings, idsBatch),
      ),
    )
  ).flat();
  const directById = new Map(
    directMatches.map((item) => [String(item.ItemId || ""), item]),
  );

  for (const item of exclusions) {
    const match = directById.get(String(item.ItemId || ""));
    if (match) matches.set(exclusionItemKey(item), match);
  }

  const missingDirectMatches = exclusions.filter(
    (item) => !matches.has(exclusionItemKey(item)),
  );
  await mapWithConcurrency(missingDirectMatches, async (item) => {
    const results = await searchMediaServer(settings, item.Title);
    const match = results.find((candidate) => isSameExclusion(candidate, item));
    if (match) matches.set(exclusionItemKey(item), match);
  });

  return { checked: true, matches };
}

function classifyEvidence(entry) {
  const missing = entry.evidence.filter((item) => item.status === "missing");
  const present = entry.evidence.filter((item) => item.status === "present");
  if (missing.length >= 2 && present.length === 0) {
    return {
      ...entry,
      status: "confirmed_absent",
      issues: missing.map(issueFromEvidence),
    };
  }
  if (missing.length > 0) {
    return {
      ...entry,
      status: "discrepancy",
      issues: missing.map(issueFromEvidence),
    };
  }
  return null;
}

export async function exclusionIntegrityReport({
  exclusions = [],
  settings,
  mediaServerLookup = defaultMediaServerLookup,
  sourcePathChecker = sourcePathStatus,
  arrRecordChecker = checkArrRecord,
} = {}) {
  const active = asList(exclusions);
  const evidenceByKey = new Map();
  const warnings = [];
  const checks = {
    mediaServer: { checked: false, skipped: active.length, found: 0 },
    source: { checked: 0, skipped: 0 },
    arr: { checked: 0, skipped: 0 },
  };

  if (active.length > 0) {
    try {
      const mediaCheck = await mediaServerLookup(settings, active);
      if (mediaCheck.warning) warnings.push(mediaCheck.warning);
      checks.mediaServer.checked = Boolean(mediaCheck.checked);
      checks.mediaServer.skipped = mediaCheck.checked ? 0 : active.length;
      checks.mediaServer.found = mediaCheck.matches?.size || 0;
      if (mediaCheck.checked) {
        for (const item of active) {
          if (mediaCheck.matches?.has(exclusionItemKey(item))) {
            addEvidence(evidenceByKey, item, {
              code: "media_server_present",
              message: `Matching ${mediaServerLabel(settings)} media was found.`,
              status: "present",
            });
          } else {
            addEvidence(evidenceByKey, item, {
              code: "missing_media_server_item",
              message: `No matching ${mediaServerLabel(settings)} item was found for this exclusion.`,
              status: "missing",
            });
          }
        }
      }
    } catch (error) {
      warnings.push(
        `${mediaServerLabel(settings)} could not be checked for exclusions: ${error.message}`,
      );
    }
  }

  await mapWithConcurrency(active, async (item) => {
    const sourceCheck = await sourcePathChecker(settings, item.Path);
    if (!sourceCheck.checked) {
      checks.source.skipped += 1;
      if (sourceCheck.warning) warnings.push(sourceCheck.warning);
    } else {
      checks.source.checked += 1;
      addEvidence(evidenceByKey, item, sourceCheck.missing
        ? {
            code: "missing_source_file",
            message: "The verified source media path saved on this exclusion could not be found.",
            status: "missing",
          }
        : {
            code: "source_file_present",
            message: "The verified source media path is present.",
            status: "present",
          });
    }

    const arrCheck = await arrRecordChecker(settings, item);
    if (!arrCheck.checked) {
      checks.arr.skipped += 1;
      if (arrCheck.warning) warnings.push(arrCheck.warning);
    } else {
      checks.arr.checked += 1;
      addEvidence(evidenceByKey, item, arrCheck.missing
        ? {
            ...(arrCheck.issue || {}),
            status: "missing",
          }
        : {
            code: "arr_record_present",
            message: "A matching Arr record is present.",
            status: "present",
          });
    }
  });

  const classified = [...evidenceByKey.values()]
    .map(classifyEvidence)
    .filter(Boolean)
    .sort((left, right) =>
      String(left.Title).localeCompare(String(right.Title)) ||
      String(left.Type).localeCompare(String(right.Type)),
    );
  const items = classified.filter((item) => item.status === "confirmed_absent");
  const reviewItems = classified.filter((item) => item.status === "discrepancy");
  const uniqueWarnings = [...new Set(warnings)];
  const status = items.length > 0
    ? "issues"
    : reviewItems.length > 0 || uniqueWarnings.length > 0
      ? "inconclusive"
      : "clean";

  return {
    ok: status === "clean",
    status,
    checkedAt: new Date().toISOString(),
    exclusionTotal: active.length,
    staleCount: items.length,
    reviewCount: reviewItems.length,
    issueCount: classified.reduce((total, item) => total + item.issues.length, 0),
    items,
    reviewItems,
    warnings: uniqueWarnings,
    checks,
    message: status === "issues"
      ? `${items.length} exclusion(s) are confirmed absent and can be removed.`
      : status === "inconclusive"
        ? `${reviewItems.length || "Some"} exclusion(s) need review before removal.`
        : "Exclusions look good.",
  };
}
