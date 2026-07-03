const fallbackMessages = {
  media_server_not_selected:
    "Choose Emby or Jellyfin in Settings before scanning or managing media.",
  media_server_setup_incomplete:
    "Finish the media server setup before scanning or managing media. Add the server URL, API key, and search libraries in Settings.",
  media_server_connection_failed:
    "The media server is currently unavailable. Check the server URL, API key, and network access, then retry.",
};

export function mediaServerErrorMessage(error) {
  const code = error?.payload?.error;
  if (code && fallbackMessages[code]) {
    return error.payload?.message || fallbackMessages[code];
  }
  return error?.message || "Media server request failed.";
}
