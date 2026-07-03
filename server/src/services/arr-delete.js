import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 15000;

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function arrDeleteRequest(service, config, pathname, searchParams = {}) {
  if (!config?.Enabled || !config.Url || !config.ApiKey) {
    throw new Error("Arr deletion service is not enabled or configured");
  }

  const url = new URL(`${trimUrl(config.Url)}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, String(value));
  }

  await fetchExternal({
    service,
    operation: "delete media",
    url,
    timeoutMs: TIMEOUT_MS,
    options: {
      method: "DELETE",
      headers: { "X-Api-Key": config.ApiKey },
    },
  });
}

export async function deleteMovieViaRadarr(settings, item) {
  if (!item.ArrId) throw new Error("Radarr ID is missing");
  await arrDeleteRequest("Radarr", settings.Arrs.Radarr, `/api/v3/movie/${item.ArrId}`, {
    deleteFiles: true,
    addImportExclusion: true,
  });
  return { method: "radarr", message: "Deleted through Radarr" };
}

export async function deleteSeriesViaSonarr(settings, item) {
  if (!item.ArrId) throw new Error("Sonarr ID is missing");
  await arrDeleteRequest("Sonarr", settings.Arrs.Sonarr, `/api/v3/series/${item.ArrId}`, {
    deleteFiles: true,
    addImportListExclusion: true,
  });
  return { method: "sonarr", message: "Deleted through Sonarr" };
}

export async function deleteViaArr(settings, item) {
  if (item.Type === "Movie" && item.Arr === "Radarr") {
    return deleteMovieViaRadarr(settings, item);
  }
  if (item.Type === "Series" && item.Arr === "Sonarr") {
    return deleteSeriesViaSonarr(settings, item);
  }
  throw new Error("No matching Arr delete target");
}
