import { Router } from "express";
import {
  maskSettings,
  mergeSettings,
  mergeSubmittedSecrets,
  normalizeRuntimeManagedSettings,
  validateSettings,
} from "../config/settings.js";
import { JsonStoreError } from "../storage/json-store.js";
import { testConnection } from "../services/connection-tests.js";
import {
  checkForUpdates,
  getCurrentVersion,
} from "../services/updates.js";
import {
  getMediaServerGenres,
  getMediaServerUsers,
  getMediaServerVirtualFolders,
  mediaServerDeletionLibraryNames,
  mediaServerLabel,
  mediaServerSelected,
} from "../services/media-server.js";
import {
  mediaServerConnectionDetailsError,
  mediaServerConnectionError,
  mediaServerStateError,
  responseForMediaServerError,
} from "../services/media-server-state.js";
import { hashPassword } from "../services/auth.js";
import { cleanupRuleSummary } from "../services/cleanup-summary.js";

async function loadSettings(store, defaults) {
  const saved = await store.read();
  return mergeSettings(defaults, saved);
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function activeMediaServerConfig(settings) {
  return settings.MediaServer?.Provider === "jellyfin"
    ? settings.Jellyfin
    : settings.Emby;
}

function normalizeMediaLibrary(folder) {
  const name = String(folder?.Name || folder?.name || "").trim();
  if (!name) return null;

  const collectionType = String(
    folder?.CollectionType ||
      folder?.collectionType ||
      folder?.Type ||
      folder?.type ||
      "",
  ).toLowerCase();

  if (!/movies|tvshows|series/.test(collectionType)) return null;

  return {
    id: String(folder?.ItemId || folder?.Id || name),
    name,
    type: /movies/.test(collectionType) ? "Movies" : "Shows",
    collectionType,
  };
}

export function createSettingsRouter({
  settingsStore,
  defaults,
  updateManifestUrl,
  updateChecks,
  onSettingsSaved,
}) {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      response.json(maskSettings(settings));
    } catch (error) {
      next(error);
    }
  });

  router.put("/", async (request, response, next) => {
    try {
      const current = await loadSettings(settingsStore, defaults);
      const submitted = mergeSettings(defaults, request.body);
      const settings = normalizeRuntimeManagedSettings(
        mergeSubmittedSecrets(current, submitted),
        defaults,
      );
      if (settings.Auth?.Password?.trim()) {
        settings.Auth.PasswordHash = hashPassword(settings.Auth.Password);
      } else {
        settings.Auth.PasswordHash = current.Auth?.PasswordHash || "";
      }
      settings.Auth.Password = "";
      delete settings.Auth.PasswordConfigured;
      const currentProvider = String(current.MediaServer?.Provider || "emby");
      const nextProvider = String(settings.MediaServer?.Provider || "emby");
      if (current.MediaServer?.Locked === true && nextProvider !== currentProvider) {
        response.status(400).json({
          error: "invalid_settings",
          details: [
            "MediaServer.Provider cannot be changed after the provider is locked",
          ],
        });
        return;
      }
      const errors = validateSettings(settings);

      if (errors.length > 0) {
        response.status(400).json({ error: "invalid_settings", details: errors });
        return;
      }

      await settingsStore.write(settings);
      await onSettingsSaved?.();
      response.json({ ok: true, settings: maskSettings(settings) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/cleanup-summary", async (request, response, next) => {
    try {
      const current = await loadSettings(settingsStore, defaults);
      const draft = mergeSettings(current, request.body || {});
      response.json(cleanupRuleSummary(draft));
    } catch (error) {
      next(error);
    }
  });

  router.post("/test/:service", async (request, response, next) => {
    try {
      const current = await loadSettings(settingsStore, defaults);
      const draft = mergeSettings(current, request.body || {});
      const settings = mergeSubmittedSecrets(current, draft);
      const result = await testConnection(request.params.service, settings);
      response.json({ ok: true, ...result });
    } catch (error) {
      if (
        error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error instanceof TypeError ||
        !(error instanceof JsonStoreError)
      ) {
        response.status(400).json({
          error: "connection_failed",
          message: error.message || "Connection test failed",
        });
        return;
      }
      next(error);
    }
  });

  async function respondWithMediaServerUsers(_request, response) {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      if (!mediaServerSelected(settings)) {
        responseForMediaServerError(response, mediaServerConnectionDetailsError(settings));
        return;
      }
      const setupError = mediaServerConnectionDetailsError(settings);
      if (setupError) {
        responseForMediaServerError(response, setupError);
        return;
      }
      const label = mediaServerLabel(settings);
      const selectedUserIds = asList(
        activeMediaServerConfig(settings).UserIds,
      );
      response.json({
        provider: label,
        users: await getMediaServerUsers(settings),
        selectedUserIds,
        allSelected: selectedUserIds.length === 0,
      });
    } catch (error) {
      const settings = await loadSettings(settingsStore, defaults);
      responseForMediaServerError(response, mediaServerConnectionError(settings));
    }
  }

  async function settingsFromRequest(request) {
    const current = await loadSettings(settingsStore, defaults);
    if (!request.body || Object.keys(request.body).length === 0) {
      return current;
    }
    const draft = mergeSettings(current, request.body || {});
    return mergeSubmittedSecrets(current, draft);
  }

  async function respondWithMediaServerLibraries(request, response) {
    let settings = null;
    try {
      settings = await settingsFromRequest(request);
      if (!mediaServerSelected(settings)) {
        responseForMediaServerError(response, mediaServerConnectionDetailsError(settings));
        return;
      }
      const setupError = mediaServerConnectionDetailsError(settings);
      if (setupError) {
        responseForMediaServerError(response, setupError);
        return;
      }
      const config = activeMediaServerConfig(settings);
      const deletionLibraryNames = mediaServerDeletionLibraryNames(settings);
      const libraries = (await getMediaServerVirtualFolders(settings))
        .map(normalizeMediaLibrary)
        .filter(Boolean)
        .filter((library) => !deletionLibraryNames.has(library.name.toLowerCase()))
        .sort((left, right) => left.name.localeCompare(right.name));
      const selectedLibraries = asList(config.SearchLibraries).filter(
        (name) => !deletionLibraryNames.has(String(name || "").trim().toLowerCase()),
      );

      response.json({
        provider: mediaServerLabel(settings),
        libraries,
        selectedLibraries,
      });
    } catch (error) {
      if (settings) {
        responseForMediaServerError(response, mediaServerConnectionError(settings));
        return;
      }
      response.status(400).json({
        error: "media_server_libraries_failed",
        message: error.message || "Unable to load media server libraries",
      });
    }
  }

  async function respondWithMediaServerGenres(_request, response) {
    try {
      const settings = await loadSettings(settingsStore, defaults);
      if (!mediaServerSelected(settings)) {
        responseForMediaServerError(response, mediaServerStateError(settings));
        return;
      }
      const setupError = mediaServerStateError(settings);
      if (setupError) {
        responseForMediaServerError(response, setupError);
        return;
      }
      response.json({
        provider: mediaServerLabel(settings),
        genres: await getMediaServerGenres(settings),
      });
    } catch (error) {
      const settings = await loadSettings(settingsStore, defaults);
      responseForMediaServerError(response, mediaServerConnectionError(settings));
    }
  }

  router.get("/emby/users", respondWithMediaServerUsers);
  router.get("/emby/genres", respondWithMediaServerGenres);
  router.get("/emby/libraries", respondWithMediaServerLibraries);
  router.get("/media-server/users", respondWithMediaServerUsers);
  router.get("/media-server/genres", respondWithMediaServerGenres);
  router.get("/media-server/libraries", respondWithMediaServerLibraries);
  router.post("/media-server/libraries", respondWithMediaServerLibraries);

  router.get("/updates", async (_request, response, next) => {
    try {
      const status = updateChecks
        ? await updateChecks.status()
        : {
            enabled: false,
            configured: Boolean(updateManifestUrl),
            running: false,
            lastCheck: null,
            nextCheck: null,
          };
      response.json({
        currentVersion: getCurrentVersion(),
        updateSourceConfigured: Boolean(updateManifestUrl),
        autoCheckEnabled: status.enabled,
        updateCheckRunning: status.running,
        lastCheck: status.lastCheck,
        nextCheck: status.nextCheck,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/updates/check", async (_request, response) => {
    try {
      response.json(
        updateChecks
          ? await updateChecks.runNow({ source: "manual" })
          : await checkForUpdates(updateManifestUrl),
      );
    } catch (error) {
      response.status(502).json({
        error: "update_check_failed",
        message: error.message,
        currentVersion: getCurrentVersion(),
      });
    }
  });

  return router;
}
