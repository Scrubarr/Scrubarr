function configuredSecret(value) {
  return Boolean(value) || value === true;
}

export function mediaServerFromSettings(settings) {
  const locked = settings?.MediaServer?.Locked === true;
  const provider = settings?.MediaServer?.Provider === "jellyfin" ? "jellyfin" : "emby";
  const label = locked ? (provider === "jellyfin" ? "Jellyfin" : "Emby") : "Media server";
  const key = provider === "jellyfin" ? "Jellyfin" : "Emby";
  const config = locked ? settings?.[key] || {} : {};
  const libraries = Array.isArray(config.SearchLibraries)
    ? config.SearchLibraries.filter((library) => String(library || "").trim())
    : [];

  return {
    selected: locked,
    locked,
    provider: locked ? provider : null,
    key: locked ? key : null,
    label,
    config,
    libraries,
    configured: Boolean(
      locked &&
        String(config.ServerUrl || "").trim() &&
        configuredSecret(config.ApiKeyConfigured) &&
        libraries.length > 0,
    ),
    hasServerDetails: Boolean(
      locked &&
        String(config.ServerUrl || "").trim() &&
        configuredSecret(config.ApiKeyConfigured),
    ),
  };
}

export function mediaServerFromStatus(status) {
  const locked = status?.mediaServer?.locked === true;
  return {
    selected: locked,
    locked,
    provider: locked ? status?.mediaServer?.provider || null : null,
    label: locked ? status?.mediaServer?.label || "Media server" : "Media server",
    configured: locked && status?.mediaServer?.configured === true,
  };
}
