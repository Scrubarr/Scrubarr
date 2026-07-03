import { Router } from "express";
import { mergeSettings } from "../config/settings.js";
import {
  getMediaServerMediaOverview,
  mediaServerConfigured,
  mediaServerLabel,
  mediaServerProvider,
  mediaServerSelected,
  searchMediaServer,
} from "../services/media-server.js";
import { getArrDiskSpace } from "../services/arr-diskspace.js";
import { storageByMediaRoot } from "../services/storage-stats.js";
import { resolveArrIds } from "../services/arr-resolver.js";
import { isSameExclusion, markExcluded } from "../services/exclusions.js";
import { activePendingItems } from "../services/pending-state.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function markDashboardSearchState(items, { pending, exclusions }) {
  const active = activePendingItems(pending);
  return markExcluded(items, asList(exclusions)).map((item) => {
    const pendingMatch = active.find((pendingItem) =>
      isSameExclusion(item, pendingItem),
    );
    const pendingItemId = pendingMatch?.ItemId || item.ItemId;
    const state = pendingMatch ? "pending" : item.Excluded ? "excluded" : "available";
    return {
      ...item,
      Pending: Boolean(pendingMatch),
      PendingItemId: pendingItemId ? String(pendingItemId) : null,
      State: state,
    };
  });
}

export function createDashboardRouter({
  settingsStore,
  pendingStore,
  exclusionsStore,
  deletionStats,
  defaults,
}) {
  const router = Router();

  router.get("/stats", async (_request, response, next) => {
    let settings;
    try {
      settings = mergeSettings(defaults, await settingsStore.read());
      if (!mediaServerSelected(settings)) {
        response.status(400).json({
          error: "media_server_not_selected",
          message: "Choose Emby or Jellyfin in Settings before Scrubarr can show media server library totals.",
        });
        return;
      }
      if (!mediaServerConfigured(settings)) {
        const label = mediaServerLabel(settings);
        response.status(400).json({
          error: "media_server_setup_incomplete",
          message: `Finish ${label} setup before Scrubarr can show library totals. Add the ${label} server URL, API key, and search libraries in Settings.`,
        });
        return;
      }
      const overview = await getMediaServerMediaOverview(settings);
      const arrDiskSpace = await getArrDiskSpace(settings.Arrs);
      const deletionTotals = await deletionStats.current({
        pending: await pendingStore.read(),
      });
      response.json({
        mediaServer: {
          provider: mediaServerProvider(settings),
          label: mediaServerLabel(settings),
        },
        media: overview.media,
        deletions: deletionTotals,
        storageEnabled: arrDiskSpace.enabled,
        storage: arrDiskSpace.enabled
          ? await storageByMediaRoot(overview.items, arrDiskSpace.disks)
          : [],
        storageWarnings: arrDiskSpace.warnings,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (!settings) {
        next(error);
        return;
      }
      const label = mediaServerLabel(settings);
      response.status(502).json({
        error: "media_server_stats_failed",
        message: `${label} library totals are unavailable. Check the ${label} server URL, API key, selected libraries, and network access.${
          error.message ? ` Details: ${error.message}` : ""
        }`,
      });
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
      const settings = mergeSettings(defaults, await settingsStore.read());
      if (!mediaServerSelected(settings)) {
        response.status(400).json({
          error: "media_server_not_selected",
          message: "Choose Emby or Jellyfin in Settings before searching your media server.",
        });
        return;
      }
      if (!mediaServerConfigured(settings)) {
        const label = mediaServerLabel(settings);
        response.status(400).json({
          error: "media_server_setup_incomplete",
          message: `Finish ${label} setup before searching your media server. Add the ${label} server URL, API key, and search libraries in Settings.`,
        });
        return;
      }
      const found = await searchMediaServer(settings, term);
      const resolved = await resolveArrIds(found, settings);
      const [pending, exclusions] = await Promise.all([
        pendingStore.read(),
        exclusionsStore.read(),
      ]);
      response.json({
        items: markDashboardSearchState(resolved, { pending, exclusions }),
      });
    } catch (error) {
      response.status(502).json({
        error: "dashboard_search_failed",
        message: error.message || "Media server search failed",
      });
    }
  });

  return router;
}
