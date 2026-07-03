import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 8000;

function getProviderId(providerIds, name) {
  if (!providerIds || typeof providerIds !== "object") return null;
  const key = Object.keys(providerIds).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? String(providerIds[key]) : null;
}

async function fetchArrList(service, config, endpoint) {
  if (!config?.Enabled || !config.Url || !config.ApiKey) return [];
  const url = `${config.Url.replace(/\/+$/, "")}${endpoint}`;
  const response = await fetchExternal({
    service,
    operation: "resolve media IDs",
    url,
    timeoutMs: TIMEOUT_MS,
    options: {
      headers: { "X-Api-Key": config.ApiKey },
    },
  });
  return response.json();
}

export async function resolveArrIds(items, settings) {
  const [radarrResult, sonarrResult] = await Promise.allSettled([
    fetchArrList("Radarr", settings.Arrs.Radarr, "/api/v3/movie"),
    fetchArrList("Sonarr", settings.Arrs.Sonarr, "/api/v3/series"),
  ]);

  const radarrMovies =
    radarrResult.status === "fulfilled" ? radarrResult.value : [];
  const sonarrSeries =
    sonarrResult.status === "fulfilled" ? sonarrResult.value : [];
  const radarrByTmdb = new Map(
    radarrMovies
      .filter((item) => item.tmdbId && item.id)
      .map((item) => [String(item.tmdbId), item.id]),
  );
  const sonarrByTvdb = new Map(
    sonarrSeries
      .filter((item) => item.tvdbId && item.id)
      .map((item) => [String(item.tvdbId), item.id]),
  );

  return items.map((item) => {
    if (item.Type === "Movie") {
      const id = radarrByTmdb.get(getProviderId(item.ProviderIds, "tmdb"));
      return id ? { ...item, Arr: "Radarr", ArrId: id } : item;
    }
    if (item.Type === "Series") {
      const id = sonarrByTvdb.get(getProviderId(item.ProviderIds, "tvdb"));
      return id ? { ...item, Arr: "Sonarr", ArrId: id } : item;
    }
    return item;
  });
}

export { getProviderId };
