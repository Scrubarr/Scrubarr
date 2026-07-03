import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 15000;
const DEFAULT_TAG_NAME = "Scrubarr Pending";

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
    (tag) => String(tag.label || "").toLowerCase() === label.toLowerCase(),
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

async function tagIdForRemoval(service, config, label) {
  const existing = (await getTags(service, config)).find(
    (tag) => String(tag.label || "").toLowerCase() === label.toLowerCase(),
  );
  return existing?.id || null;
}

async function fetchArrItem(target) {
  const response = await arrRequest({
    service: target.service,
    config: target.config,
    path: target.itemPath,
  });
  return response.json();
}

async function saveArrTags(target, tagId, shouldHaveTag) {
  await arrRequest({
    service: target.service,
    config: target.config,
    path: target.editorPath,
    method: "PUT",
    body: {
      [target.idsKey]: [target.arrId],
      tags: [Number(tagId)],
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

  const tagId = shouldHaveTag
    ? await ensureTag(target.service, target.config, tagConfig.name)
    : await tagIdForRemoval(target.service, target.config, tagConfig.name);
  if (!tagId) return { skipped: true, reason: "tag-not-found" };

  const arrItem = await fetchArrItem(target);
  const tags = Array.isArray(arrItem.tags) ? arrItem.tags.map(Number) : [];
  const hasTag = tags.includes(Number(tagId));

  if (hasTag === shouldHaveTag) {
    return { skipped: true, reason: "already-synced" };
  }

  await saveArrTags(target, tagId, shouldHaveTag);
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
