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
import {
  exclusionIntegrityReport,
  exclusionItemKey,
} from "../services/exclusion-integrity.js";
import { PendingMutationCoordinator } from "../services/pending-mutation-coordinator.js";

const INTEGRITY_CACHE_TTL_MS = 60 * 1000;

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
  pendingMutations = new PendingMutationCoordinator(),
  integrityReport = exclusionIntegrityReport,
}) {
  const router = Router();
  let integrityCache = null;
  let integrityInFlight = null;

  function integrityFingerprint(settings, exclusions) {
    const config = settings?.MediaServer?.Provider === "jellyfin"
      ? settings.Jellyfin
      : settings?.Emby;
    return JSON.stringify({
      exclusions,
      provider: settings?.MediaServer?.Provider,
      media: {
        url: config?.ServerUrl,
        apiKey: config?.ApiKey,
      },
      fallback: settings?.CleanupRules?.FallbackFileDeletion,
      allowedRoots: settings?.CleanupRules?.DirectFileDeletionAllowedRoots,
      radarr: settings?.Arrs?.Radarr,
      sonarr: settings?.Arrs?.Sonarr,
    });
  }

  function invalidateIntegrityCache() {
    integrityCache = null;
  }

  async function getIntegrityReport({ settings, exclusions, force = false }) {
    const fingerprint = integrityFingerprint(settings, exclusions);
    const now = Date.now();
    if (
      !force &&
      integrityCache?.fingerprint === fingerprint &&
      integrityCache.expiresAt > now
    ) {
      return integrityCache.report;
    }
    if (integrityInFlight?.fingerprint === fingerprint) {
      return integrityInFlight.promise;
    }

    const promise = Promise.resolve().then(() =>
      integrityReport({ exclusions, settings }),
    ).then((report) => {
      integrityCache = {
        fingerprint,
        expiresAt: Date.now() + INTEGRITY_CACHE_TTL_MS,
        report,
      };
      return report;
    }).finally(() => {
      if (integrityInFlight?.fingerprint === fingerprint) {
        integrityInFlight = null;
      }
    });
    integrityInFlight = { fingerprint, promise };
    return promise;
  }

  router.get("/", async (_request, response, next) => {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      const exclusions = await exclusionsStore.read();
      const enriched = await enrichExclusionsWithMediaServerDetails(exclusions, settings);
      response.json(enriched);
    } catch (error) {
      next(error);
    }
  });

  router.get("/integrity", async (_request, response, next) => {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      const exclusions = asList(await exclusionsStore.read());
      response.json(await getIntegrityReport({ settings, exclusions }));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/stale", async (_request, response, next) => {
    try {
      const result = await pendingMutations.run(
        "exclusion-remove-confirmed-stale",
        async () => {
          const settings = await loadSettings(settingsStore, defaults);
          const current = asList(await exclusionsStore.read());
          const report = await getIntegrityReport({
            exclusions: current,
            settings,
            force: true,
          });
          const staleKeys = new Set(report.items.map((item) => item.key));
          const staleSnapshots = new Map(
            current
              .filter((item) => staleKeys.has(exclusionItemKey(item)))
              .map((item) => [exclusionItemKey(item), JSON.stringify(item)]),
          );
          const latest = asList(await exclusionsStore.read());
          const isStillStale = (item) =>
            staleSnapshots.get(exclusionItemKey(item)) === JSON.stringify(item);
          const remaining = latest.filter((item) => !isStillStale(item));
          const removed = latest.filter((item) => isStillStale(item));

          if (remaining.length !== latest.length) {
            await exclusionsStore.write(remaining);
            invalidateIntegrityCache();
          }
          return { removed, report };
        },
      );

      response.json({
        ok: true,
        removedCount: result.removed.length,
        removed: result.removed,
        report: result.report,
      });
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
      const body = await pendingMutations.run("exclusion-add", async () => {
        const exclusion = normalizeExclusion(request.body);
        const current = asList(await exclusionsStore.read());
        const existing = current.find((item) => isSameExclusion(item, exclusion));

        if (!existing) {
          await exclusionsStore.write([...current, exclusion]);
          invalidateIntegrityCache();
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

        return {
          added: !existing,
          exclusion: existing || exclusion,
          removedFromPending: pending.length - remaining.length,
          librarySync,
        };
      });

      response.status(body.added ? 201 : 200).json({
        ok: true,
        ...body,
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
      const result = await pendingMutations.run("exclusion-remove", async () => {
        const itemId = String(request.params.itemId);
        const current = asList(await exclusionsStore.read());
        const remaining = current.filter(
          (item) => String(item.ItemId) !== itemId,
        );
        if (remaining.length === current.length) return { found: false };
        await exclusionsStore.write(remaining);
        invalidateIntegrityCache();
        return { found: true };
      });
      if (!result.found) {
        response.status(404).json({ error: "exclusion_not_found" });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
