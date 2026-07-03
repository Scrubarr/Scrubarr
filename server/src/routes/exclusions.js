import { Readable } from "node:stream";
import { Router } from "express";
import { mergeSettings } from "../config/settings.js";
import {
  fetchMediaServerPrimaryImage,
  getMediaServerItemsByIds,
  searchMediaServer,
} from "../services/media-server.js";
import { resolveArrIds } from "../services/arr-resolver.js";
import {
  isSameExclusion,
  markExcluded,
  normalizeExclusion,
} from "../services/exclusions.js";

async function loadSettings(settingsStore, defaults) {
  return mergeSettings(defaults, await settingsStore.read());
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

async function enrichExclusionsWithMediaServerDetails(exclusions, settings) {
  const items = asList(exclusions);
  const idsNeedingDetails = items
    .filter((item) => item.ItemId && (!item.HasPrimaryImage || !item.Year))
    .map((item) => item.ItemId);
  if (idsNeedingDetails.length === 0) return items;

  const details = await getMediaServerItemsByIds(settings, idsNeedingDetails).catch(
    () => [],
  );
  const byId = new Map(details.map((item) => [String(item.ItemId), item]));
  const enriched = items.map((item) => {
    const match = byId.get(String(item.ItemId));
    if (!match) return item;
    return {
      ...item,
      Title: item.Title || match.Title,
      Type: item.Type || match.Type,
      Year: item.Year || match.Year,
      Path: item.Path || match.Path,
      HasPrimaryImage: match.HasPrimaryImage || item.HasPrimaryImage,
      ProviderIds: item.ProviderIds || match.ProviderIds,
    };
  });

  const stillMissingDetails = enriched.filter(
    (item) => item.ItemId && (!item.HasPrimaryImage || !item.Year),
  );
  if (stillMissingDetails.length === 0) return enriched;

  const repaired = await Promise.all(
    enriched.map(async (item) => {
      if (!stillMissingDetails.includes(item)) return item;
      const found = await searchMediaServer(settings, item.Title).catch(() => []);
      const resolved = await resolveArrIds(found, settings).catch(() => found);
      const match = resolved.find((candidate) => isSameExclusion(candidate, item));
      if (!match) return item;
      return {
        ...item,
        Title: item.Title || match.Title,
        Type: item.Type || match.Type,
        ItemId: match.ItemId || item.ItemId,
        Year: item.Year || match.Year,
        Path: item.Path || match.Path,
        HasPrimaryImage: match.HasPrimaryImage || item.HasPrimaryImage,
        ProviderIds: item.ProviderIds || match.ProviderIds,
      };
    }),
  );

  return repaired;
}

export function createExclusionsRouter({
  exclusionsStore,
  pendingStore,
  settingsStore,
  defaults,
  onPendingRemoved,
  onPendingChanged,
}) {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      const exclusions = await exclusionsStore.read();
      const enriched = await enrichExclusionsWithMediaServerDetails(exclusions, settings);
      if (JSON.stringify(enriched) !== JSON.stringify(asList(exclusions))) {
        await exclusionsStore.write(enriched);
      }
      response.json(enriched);
    } catch (error) {
      next(error);
    }
  });

  router.get("/search", async (request, response) => {
    const term = String(request.query.q || "").trim();
    if (term.length < 2 || term.length > 100) {
      response.status(400).json({
        error: "invalid_search",
        message: "Enter between 2 and 100 characters",
      });
      return;
    }

    try {
      const settings = await loadSettings(settingsStore, defaults);
      const exclusions = asList(await exclusionsStore.read());
      const enriched = await enrichExclusionsWithMediaServerDetails(exclusions, settings);
      const query = term.toLowerCase();
      response.json({
        items: markExcluded(
          enriched.filter((item) =>
            [
              item.Title,
              item.Type,
              item.Year,
              item.Arr,
              item.ArrId,
              item.Path,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query),
          ),
          enriched,
        ),
      });
    } catch (error) {
      response.status(502).json({
        error: "exclusion_search_failed",
        message: error.message || "Exclusion search failed",
      });
    }
  });

  router.get("/image/:itemId", async (request, response) => {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      const image = await fetchMediaServerPrimaryImage(settings, request.params.itemId);
      response.setHeader(
        "Content-Type",
        image.headers.get("content-type") || "image/jpeg",
      );
      response.setHeader("Cache-Control", "private, max-age=3600");
      if (!image.body) {
        response.status(404).end();
        return;
      }
      Readable.fromWeb(image.body).pipe(response);
    } catch {
      response.status(404).end();
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const exclusion = normalizeExclusion(request.body);
      const current = asList(await exclusionsStore.read());
      const existing = current.find((item) => isSameExclusion(item, exclusion));

      if (!existing) {
        await exclusionsStore.write([...current, exclusion]);
      }

      const pending = asList(await pendingStore.read());
      const remaining = pending.filter(
        (item) => !isSameExclusion(item, exclusion),
      );
      if (remaining.length !== pending.length) {
        const removed = pending.filter((item) => isSameExclusion(item, exclusion));
        await pendingStore.write(remaining);
        await onPendingRemoved?.(removed);
      }
      let librarySync = null;
      if (remaining.length !== pending.length) {
        try {
          librarySync = await onPendingChanged?.();
        } catch (error) {
          librarySync = {
            status: "failed",
            message: error.message || "Library sync failed",
          };
        }
      }

      response.status(existing ? 200 : 201).json({
        ok: true,
        added: !existing,
        exclusion: existing || exclusion,
        removedFromPending: pending.length - remaining.length,
        librarySync,
      });
    } catch (error) {
      if (error.message?.includes("required")) {
        response.status(400).json({
          error: "invalid_exclusion",
          message: error.message,
        });
        return;
      }
      next(error);
    }
  });

  router.delete("/:itemId", async (request, response, next) => {
    try {
      const itemId = String(request.params.itemId);
      const current = asList(await exclusionsStore.read());
      const remaining = current.filter(
        (item) => String(item.ItemId) !== itemId,
      );
      if (remaining.length === current.length) {
        response.status(404).json({ error: "exclusion_not_found" });
        return;
      }
      await exclusionsStore.write(remaining);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
