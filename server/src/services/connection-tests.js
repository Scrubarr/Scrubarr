import { externalServiceFailure, fetchExternal } from "./external-error.js";
import { jellyfinHeaders } from "./jellyfin.js";

const TIMEOUT_MS = 8000;

async function requestJson(url, options = {}, { service, operation } = {}) {
  const response = await fetchExternal({
    service,
    operation,
    url,
    timeoutMs: TIMEOUT_MS,
    options,
  });

  return response.json();
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

export async function testConnection(service, settings) {
  if (service === "emby") {
    const config = settings.Emby;
    if (!config.ServerUrl || !config.ApiKey) {
      throw new Error("Emby URL and API key are required");
    }
    const data = await requestJson(
      `${trimUrl(config.ServerUrl)}/System/Info`,
      { headers: { "X-Emby-Token": config.ApiKey } },
      { service: "Emby", operation: "test connection" },
    );
    return { name: data.ServerName || "Emby", version: data.Version || null };
  }

  if (service === "jellyfin") {
    const config = settings.Jellyfin;
    if (!config.ServerUrl || !config.ApiKey) {
      throw new Error("Jellyfin URL and API key are required");
    }
    const data = await requestJson(
      `${trimUrl(config.ServerUrl)}/System/Info`,
      { headers: jellyfinHeaders(config) },
      { service: "Jellyfin", operation: "test connection" },
    );
    return { name: data.ServerName || "Jellyfin", version: data.Version || null };
  }

  if (service === "radarr" || service === "sonarr") {
    const name = service === "radarr" ? "Radarr" : "Sonarr";
    const config = settings.Arrs[name];
    if (!config.Url || !config.ApiKey) {
      throw new Error(`${name} URL and API key are required`);
    }
    const data = await requestJson(
      `${trimUrl(config.Url)}/api/v3/system/status`,
      { headers: { "X-Api-Key": config.ApiKey } },
      { service: name, operation: "test connection" },
    );
    return { name: data.appName || name, version: data.version || null };
  }

  if (service === "telegram") {
    const config = settings.Telegram;
    if (!config.BotToken) throw new Error("Telegram bot token is required");
    const data = await requestJson(
      `https://api.telegram.org/bot${encodeURIComponent(config.BotToken)}/getMe`,
      {},
      { service: "Telegram", operation: "test connection" },
    );
    if (!data.ok) {
      throw externalServiceFailure({
        service: "Telegram",
        operation: "test connection",
        detail: data.description || "Telegram rejected the token",
      });
    }
    return {
      name: data.result?.username
        ? `@${data.result.username}`
        : data.result?.first_name || "Telegram bot",
      version: null,
    };
  }

  throw new Error("Unsupported service");
}
