import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 15000;
const DEFAULT_TAG_NAME = "scrubarr-pending";

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function pendingTagSettings(settings) {
  const config = settings?.Arrs?.PendingTag || {};
  const name = String(config.Name || DEFAULT_TAG_NAME).trim();
  return {
    enabled: config.Enabled === true && name.length > 0,
    name,
  };
}

function arrSafeTagName(label) {
  const normalized = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return normalized || "scrubarr-pending";
}

function uniqueLabels(labels) {
  const seen = new Set();
  return labels
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function tagLabelsForConfig(label) {
  const desired = arrSafeTagName(label);
  return {
    desired,
    legacy: uniqueLabels([desired, label]),
  };
}

function tagMatchesLabel(tag, label) {
  return String(tag?.label || "").toLowerCase() === String(label || "").toLowerCase();
}

function arrTargetForItem(settings, item) {
  if (item?.Type === "Movie" && item?.Arr === "Radarr") {
    return {
      service: "Radarr",
      config: settings?.Arrs?.Radarr,
      itemPath: `/api/v3/movie/${item.ArrId}`,
      editorPath: "/api/v3/movie/editor",
      idsKey: "movieIds",
      arrId: Number(item.ArrId),
    };
  }
  if (item?.Type === "Series" && item?.Arr === "Sonarr") {
    return {
      service: "Sonarr",
      config: settings?.Arrs?.Sonarr,
      itemPath: `/api/v3/series/${item.ArrId}`,
      editorPath: "/api/v3/series/editor",
      idsKey: "seriesIds",
      arrId: Number(item.ArrId),
    };
  }
  return null;
}

async function arrRequest({ service, config, path, query = {}, method = "GET", body }) {
  if (!config?.Enabled || !config.Url || !config.ApiKey) {
    throw new Error(`${service} is not enabled or configured`);
  }

  const url = new URL(`${trimUrl(config.Url)}${path}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  return fetchExternal({
    service,
    operation: "sync pending tag",
    url,
    timeoutMs: TIMEOUT_MS,
    options: {
      method,
      headers: {
        "X-Api-Key": config.ApiKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  });
}

async function getTags(service, config) {
  const response = await arrRequest({ service, config, path: "/api/v3/tag" });
  const tags = await response.json();
  return Array.isArray(tags) ? tags : [];
}

async function ensureTag(service, config, label) {
  const existing = (await getTags(service, config)).find(
    (tag) => tagMatchesLabel(tag, label),
  );
  if (existing?.id) return existing.id;

  const response = await arrRequest({
    service,
    config,
    path: "/api/v3/tag",
    method: "POST",
    body: { label },
  });
  const created = await response.json();
  if (!created?.id) throw new Error(`${service} did not return a tag id`);
  return created.id;
}

async function tagIdsForRemoval(service, config, labels) {
  const tags = await getTags(service, config);
  return tags
    .filter((tag) => labels.some((label) => tagMatchesLabel(tag, label)))
    .map((tag) => Number(tag.id))
    .filter(Boolean);
}

async function fetchArrItem(target) {
  const response = await arrRequest({
    service: target.service,
    config: target.config,
    path: target.itemPath,
  });
  return response.json();
}

async function saveArrTags(target, tagIds, shouldHaveTag) {
  const tags = (Array.isArray(tagIds) ? tagIds : [tagIds]).map(Number).filter(Boolean);
  if (tags.length === 0) return;
  await arrRequest({
    service: target.service,
    config: target.config,
    path: target.editorPath,
    method: "PUT",
    body: {
      [target.idsKey]: [target.arrId],
      tags,
      applyTags: shouldHaveTag ? "add" : "remove",
    },
  });
}

async function setPendingTag(settings, item, shouldHaveTag) {
  const tagConfig = pendingTagSettings(settings);
  if (!tagConfig.enabled) return { skipped: true, reason: "disabled" };
  if (!item?.ArrId) return { skipped: true, reason: "missing-arr-id" };

  const target = arrTargetForItem(settings, item);
  if (!target) return { skipped: true, reason: "unsupported-arr-target" };

  const tagLabels = tagLabelsForConfig(tagConfig.name);
  const tagIds = shouldHaveTag
    ? [await ensureTag(target.service, target.config, tagLabels.desired)]
    : await tagIdsForRemoval(target.service, target.config, tagLabels.legacy);
  if (tagIds.length === 0) return { skipped: true, reason: "tag-not-found" };

  const arrItem = await fetchArrItem(target);
  const tags = Array.isArray(arrItem.tags) ? arrItem.tags.map(Number) : [];
  const currentTagIds = tagIds.filter((tagId) => tags.includes(Number(tagId)));

  if (shouldHaveTag && currentTagIds.length > 0) {
    return { skipped: true, reason: "already-synced" };
  }
  if (!shouldHaveTag && currentTagIds.length === 0) {
    return { skipped: true, reason: "already-synced" };
  }

  await saveArrTags(target, shouldHaveTag ? tagIds : currentTagIds, shouldHaveTag);
  return { updated: true, service: target.service };
}

async function syncPendingTags({ settings, items, shouldHaveTag }) {
  const tagConfig = pendingTagSettings(settings);
  const media = Array.isArray(items) ? items : [];
  if (!tagConfig.enabled) {
    return {
      enabled: false,
      updated: 0,
      failed: 0,
      skipped: media.length,
      errors: [],
    };
  }

  const result = {
    enabled: true,
    tagName: tagConfig.name,
    updated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const item of media) {
    try {
      const synced = await setPendingTag(settings, item, shouldHaveTag);
      if (synced.updated) result.updated += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        itemId: item?.ItemId || null,
        title: item?.Title || "Unknown media",
        message: error.message || "Arr tag sync failed",
      });
    }
  }

  return result;
}

export function arrPendingTagEnabled(settings) {
  return pendingTagSettings(settings).enabled;
}

export async function applyArrPendingTags({ settings, items }) {
  return syncPendingTags({ settings, items, shouldHaveTag: true });
}

export async function removeArrPendingTags({ settings, items }) {
  return syncPendingTags({ settings, items, shouldHaveTag: false });
}
