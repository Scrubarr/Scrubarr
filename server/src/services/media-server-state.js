import {
  mediaServerConfig,
  mediaServerConfigured,
  mediaServerLabel,
  mediaServerSelected,
} from "./media-server.js";

export function mediaServerState(settings) {
  const selected = mediaServerSelected(settings);
  const label = selected ? mediaServerLabel(settings) : "Media server";
  const configured = mediaServerConfigured(settings);
  return {
    selected,
    configured,
    label,
    ready: selected && configured,
  };
}

export function mediaServerStateError(settings) {
  const state = mediaServerState(settings);
  if (!state.selected) {
    return {
      status: 400,
      error: "media_server_not_selected",
      message: "Choose Emby or Jellyfin in Settings before scanning or managing media.",
    };
  }
  if (!state.configured) {
    return {
      status: 400,
      error: "media_server_setup_incomplete",
      message: `Finish the ${state.label} setup before scanning or managing media. Add the ${state.label} server URL, API key, and search libraries in Settings.`,
    };
  }
  return null;
}

export function mediaServerConnectionDetailsError(settings) {
  const state = mediaServerState(settings);
  if (!state.selected) {
    return {
      status: 400,
      error: "media_server_not_selected",
      message: "Choose Emby or Jellyfin in Settings before scanning or managing media.",
    };
  }
  const config = mediaServerConfig(settings);
  if (!String(config.ServerUrl || "").trim() || !String(config.ApiKey || "").trim()) {
    return {
      status: 400,
      error: "media_server_setup_incomplete",
      message: `Finish the ${state.label} setup before scanning or managing media. Add the ${state.label} server URL and API key in Settings.`,
    };
  }
  return null;
}

export function mediaServerConnectionError(settings) {
  const state = mediaServerState(settings);
  const label = state.selected ? state.label : "Media server";
  return {
    status: 502,
    error: "media_server_connection_failed",
    message: `${label} is currently unavailable. Check the ${label} server URL, API key, and network access, then retry.`,
  };
}

export function responseForMediaServerError(response, result) {
  response.status(result.status).json({
    error: result.error,
    message: result.message,
  });
}
