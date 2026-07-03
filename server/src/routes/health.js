import { Router } from "express";
import { mergeSettings } from "../config/settings.js";
import { APP_VERSION } from "../config/version.js";
import {
  mediaServerConfigured,
  mediaServerLabel,
  mediaServerProvider,
  mediaServerSelected,
} from "../services/media-server.js";

export function createHealthRouter() {
  const router = Router();

  router.get("/", (_request, response) => {
    response.json({
      status: "ok",
      app: "Scrubarr",
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

function emptyUpdateStatus() {
  return {
    configured: false,
    running: false,
    updateAvailable: false,
    latestVersion: null,
    checkedAt: null,
    releaseUrl: null,
  };
}

export function createHealthStatusRouter(
  runtime,
  scheduler,
  settingsStore,
  defaults,
  updateChecks,
) {
  const router = Router();

  router.get("/status", async (_request, response, next) => {
    try {
      const settings = mergeSettings(defaults, await settingsStore.read());
      const schedule = scheduler.status();
      const previewMode = settings.CleanupRules?.DryRun === true;
      const debugLogging = settings.DebugMode?.Enabled === true;
      const provider = mediaServerProvider(settings);
      const providerLabel = mediaServerLabel(settings);
      const mediaServerLocked = mediaServerSelected(settings);
      const updateStatus = updateChecks
        ? await updateChecks.status().catch(() => null)
        : null;
      const lastUpdateCheck = updateStatus?.lastCheck || null;
      response.json({
        mode: previewMode ? "preview" : "live",
        capabilities: {
          dashboard: true,
          exclusions: true,
          settings: true,
          updateChecking: true,
          scanning: true,
          queueApproval: previewMode,
          telegram: "test-message",
          deletion: true,
          previewMode,
          directFileFallback: settings.CleanupRules?.FallbackFileDeletion === true,
          scheduling: schedule.config.enabled,
          authentication: settings.Auth?.Enabled === true,
          debugLogging,
        },
        debugLogging,
        mediaServer: {
          provider: mediaServerLocked ? provider : null,
          label: mediaServerLocked ? providerLabel : null,
          locked: mediaServerLocked,
          configured: mediaServerConfigured(settings),
        },
        timezone: runtime.timezone,
        scheduler: {
          enabled: schedule.config.enabled,
          nextRun: schedule.nextRun,
          lastRun: schedule.lastRun,
          running: schedule.running,
        },
        updates: updateStatus
          ? {
              configured: updateStatus.configured,
              running: updateStatus.running,
              updateAvailable: lastUpdateCheck?.updateAvailable === true,
              latestVersion: lastUpdateCheck?.latestVersion || null,
              checkedAt: lastUpdateCheck?.checkedAt || null,
              releaseUrl: lastUpdateCheck?.releaseUrl || null,
            }
          : emptyUpdateStatus(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
