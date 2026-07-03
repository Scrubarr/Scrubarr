import {
  ensureEmbyVirtualFolder,
  deleteEmbyVirtualFolder,
  fetchEmbyPrimaryImage,
  getEmbyGenres,
  getEmbyItemMediaPath,
  getEmbyItemsByIds,
  getEmbyActiveSessions,
  getEmbyMediaOverview,
  getEmbySeriesEpisodes,
  getEmbyUsers,
  getEmbyVirtualFolders,
  refreshEmbyLibrary,
  searchEmby,
} from "./emby.js";
import {
  ensureJellyfinVirtualFolder,
  deleteJellyfinVirtualFolder,
  fetchJellyfinPrimaryImage,
  getJellyfinGenres,
  getJellyfinItemMediaPath,
  getJellyfinItemsByIds,
  getJellyfinActiveSessions,
  getJellyfinMediaOverview,
  getJellyfinSeriesEpisodes,
  getJellyfinUsers,
  getJellyfinVirtualFolders,
  jellyfinHeaders,
  refreshJellyfinLibrary,
  searchJellyfin,
} from "./jellyfin.js";

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

const ADAPTERS = {
  emby: {
    key: "Emby",
    label: "Emby",
    headers: (config) => ({ "X-Emby-Token": config.ApiKey }),
    getVirtualFolders: getEmbyVirtualFolders,
    ensureVirtualFolder: ensureEmbyVirtualFolder,
    deleteVirtualFolder: deleteEmbyVirtualFolder,
    refreshLibrary: refreshEmbyLibrary,
    getItemMediaPath: getEmbyItemMediaPath,
    getSeriesEpisodes: getEmbySeriesEpisodes,
    search: searchEmby,
    getItemsByIds: getEmbyItemsByIds,
    getUsers: getEmbyUsers,
    getGenres: getEmbyGenres,
    getMediaOverview: getEmbyMediaOverview,
    getActiveSessions: getEmbyActiveSessions,
    fetchPrimaryImage: fetchEmbyPrimaryImage,
  },
  jellyfin: {
    key: "Jellyfin",
    label: "Jellyfin",
    headers: (config) => jellyfinHeaders(config),
    getVirtualFolders: getJellyfinVirtualFolders,
    ensureVirtualFolder: ensureJellyfinVirtualFolder,
    deleteVirtualFolder: deleteJellyfinVirtualFolder,
    refreshLibrary: refreshJellyfinLibrary,
    getItemMediaPath: getJellyfinItemMediaPath,
    getSeriesEpisodes: getJellyfinSeriesEpisodes,
    search: searchJellyfin,
    getItemsByIds: getJellyfinItemsByIds,
    getUsers: getJellyfinUsers,
    getGenres: getJellyfinGenres,
    getMediaOverview: getJellyfinMediaOverview,
    getActiveSessions: getJellyfinActiveSessions,
    fetchPrimaryImage: fetchJellyfinPrimaryImage,
  },
};

export function mediaServerProvider(settings) {
  const provider = String(settings.MediaServer?.Provider || "emby").toLowerCase();
  return provider === "jellyfin" ? "jellyfin" : "emby";
}

export function mediaServerSelected(settings) {
  if (settings.MediaServer?.Locked === true) return true;
  const provider = mediaServerProvider(settings);
  const config = mediaServerConfig(settings);
  const serverUrl = String(config.ServerUrl || "").trim().replace(/\/+$/, "");
  const hasCustomUrl = serverUrl && serverUrl !== "http://localhost:8096";
  return Boolean(
    provider !== "emby" ||
      hasCustomUrl ||
      String(config.ApiKey || "").trim(),
  );
}

export function mediaServerAdapter(settings) {
  return ADAPTERS[mediaServerProvider(settings)];
}

export function mediaServerConfig(settings) {
  const adapter = mediaServerAdapter(settings);
  return settings[adapter.key] || {};
}

export function mediaServerDeletionLibraryNames(settings) {
  const config = mediaServerConfig(settings);
  return new Set(
    Object.values(config.DeletionLibraries || {})
      .map((name) => String(name || "").trim().toLowerCase())
      .filter(Boolean),
  );
}

export function mediaServerLabel(settings) {
  return mediaServerAdapter(settings).label;
}

export function mediaServerConfigured(settings) {
  const config = mediaServerConfig(settings);
  const hasSearchLibraries =
    Array.isArray(config.SearchLibraries) &&
    config.SearchLibraries.some((library) => String(library || "").trim());

  return Boolean(
    mediaServerSelected(settings) &&
      String(config.ServerUrl || "").trim() &&
      String(config.ApiKey || "").trim() &&
      hasSearchLibraries,
  );
}

export function mediaServerConnection(settings) {
  const adapter = mediaServerAdapter(settings);
  const config = mediaServerConfig(settings);
  if (!mediaServerSelected(settings)) {
    throw new Error("Choose Emby or Jellyfin in Settings before Scrubarr can connect to a media server");
  }
  if (!config.ServerUrl || !config.ApiKey) {
    throw new Error(`${adapter.label} URL and API key must be configured in Settings`);
  }
  return {
    adapter,
    config,
    label: adapter.label,
    base: trimUrl(config.ServerUrl),
    headers: adapter.headers(config),
  };
}

export async function getMediaServerVirtualFolders(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getVirtualFolders(config);
}

export async function ensureMediaServerVirtualFolder(settings, options) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.ensureVirtualFolder(config, options);
}

export async function deleteMediaServerVirtualFolder(settings, options) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.deleteVirtualFolder(config, options);
}

export async function refreshMediaServerLibrary(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.refreshLibrary(config);
}

export async function getMediaServerItemMediaPath(settings, itemId) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getItemMediaPath(config, itemId);
}

export async function getMediaServerSeriesEpisodes(settings, seriesId) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getSeriesEpisodes(config, seriesId);
}

export async function searchMediaServer(settings, term) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.search(config, term);
}

export async function getMediaServerItemsByIds(settings, itemIds) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getItemsByIds(config, itemIds);
}

export async function getMediaServerUsers(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getUsers(config);
}

export async function getMediaServerGenres(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getGenres(config);
}

export async function getMediaServerMediaOverview(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getMediaOverview(config);
}

export async function getMediaServerActiveSessions(settings) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.getActiveSessions(config);
}

export async function activeMediaSessionForItem(settings, item) {
  const sessions = await getMediaServerActiveSessions(settings);
  const itemId = String(item?.ItemId || "");
  const type = String(item?.Type || "");
  const match = sessions.find((session) => {
    if (session.paused) return false;
    if (type === "Series") {
      return String(session.seriesId || "") === itemId;
    }
    return String(session.itemId || "") === itemId;
  });
  return match || null;
}

export async function fetchMediaServerPrimaryImage(settings, itemId) {
  const { adapter, config } = mediaServerConnection(settings);
  return adapter.fetchPrimaryImage(config, itemId);
}
