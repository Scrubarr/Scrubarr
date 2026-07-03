import { getProviderId } from "./arr-resolver.js";
import { fetchExternal } from "./external-error.js";
import {
  mediaServerConnection,
  mediaServerDeletionLibraryNames,
} from "./media-server.js";

const TIMEOUT_MS = 15000;

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

async function requestJson(url, headers = {}, { service, operation } = {}) {
  const response = await fetchExternal({
    service: service || "External service",
    operation: operation || "request",
    url,
    timeoutMs: TIMEOUT_MS,
    options: { headers },
  });
  return response.json();
}

function toDateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function latestDate(left, right) {
  const leftTime = left ? new Date(left).getTime() : 0;
  const rightTime = right ? new Date(right).getTime() : 0;
  return leftTime >= rightTime ? left : right;
}

function createEpisodeActivity() {
  return {
    episodeIds: new Set(),
    playedEpisodeIds: new Set(),
    watchHistoryKnown: true,
    playCount: 0,
    lastPlayedDate: null,
  };
}

function mergeEpisodeActivity(existing, episode) {
  if (!episode.SeriesId) return existing;
  const activity = existing || createEpisodeActivity();
  const episodeId = episode.Id ? String(episode.Id) : null;
  const playCount = Number(episode.UserData?.PlayCount || 0);
  const lastPlayedDate = toDateValue(episode.UserData?.LastPlayedDate);

  if (episodeId) activity.episodeIds.add(episodeId);
  if (episodeId && playCount > 0) activity.playedEpisodeIds.add(episodeId);
  activity.playCount += playCount;
  activity.lastPlayedDate = latestDate(activity.lastPlayedDate, lastPlayedDate);

  return activity;
}

function serializeEpisodeActivity(activity) {
  return {
    WatchHistoryKnown: activity.watchHistoryKnown,
    EpisodeCount: activity.episodeIds.size,
    PlayedEpisodeCount: activity.playedEpisodeIds.size,
    PlayCount: activity.playCount,
    LastPlayedDate: activity.lastPlayedDate,
  };
}

function mergeUserItem(existing, item) {
  if (!existing) {
    return {
      ItemId: String(item.Id),
      Title: String(item.Name || "Untitled"),
      Type: item.Type,
      Year: Number.isInteger(item.ProductionYear)
        ? item.ProductionYear
        : null,
      Path: item.Path || null,
      DateCreated: toDateValue(item.DateCreated),
      PremiereDate: toDateValue(item.PremiereDate),
      ProviderIds:
        item.ProviderIds && typeof item.ProviderIds === "object"
          ? item.ProviderIds
          : {},
      Genres: Array.isArray(item.Genres)
        ? item.Genres.filter(Boolean).map(String)
        : [],
      HasPrimaryImage: Boolean(item.ImageTags?.Primary),
      InProgress: false,
      WatchHistoryKnown:
        item.UserData !== null &&
        item.UserData !== undefined &&
        typeof item.UserData === "object",
      UserData: {
        PlayCount: Number(item.UserData?.PlayCount || 0),
        LastPlayedDate: toDateValue(item.UserData?.LastPlayedDate),
      },
    };
  }

  existing.UserData.PlayCount = Math.max(
    existing.UserData.PlayCount,
    Number(item.UserData?.PlayCount || 0),
  );
  existing.UserData.LastPlayedDate = latestDate(
    existing.UserData.LastPlayedDate,
    toDateValue(item.UserData?.LastPlayedDate),
  );
  existing.WatchHistoryKnown =
    existing.WatchHistoryKnown ||
    (item.UserData !== null &&
      item.UserData !== undefined &&
      typeof item.UserData === "object");
  return existing;
}

async function getResumeItemIds(base, headers, userIds, serviceLabel) {
  const responses = await Promise.all(
    userIds.map(async (userId) => {
      const url = new URL(
        `${base}/Users/${encodeURIComponent(userId)}/Items/Resume`,
      );
      url.searchParams.set("Recursive", "true");
      url.searchParams.set("IncludeItemTypes", "Movie,Episode");
      url.searchParams.set("Fields", "SeriesId,UserData");
      url.searchParams.set("Limit", "10000");
      return requestJson(url, headers, {
        service: serviceLabel,
        operation: "load in-progress media",
      });
    }),
  );

  const movieIds = new Set();
  const seriesIds = new Set();
  for (const item of responses.flatMap((response) => response.Items || [])) {
    if (item.Type === "Movie" && item.Id) {
      movieIds.add(String(item.Id));
    }
    if (item.Type === "Episode" && item.SeriesId) {
      seriesIds.add(String(item.SeriesId));
    }
  }
  return { movieIds, seriesIds };
}

async function getMediaServerItems(settings) {
  const { base, headers, config, label } = mediaServerConnection(settings);
  const deletionLibraryNames = mediaServerDeletionLibraryNames(settings);
  const libraryNames = new Set(
    (config.SearchLibraries || [])
      .map((name) => String(name || "").trim().toLowerCase())
      .filter((name) => name && !deletionLibraryNames.has(name)),
  );
  if (libraryNames.size === 0) {
    throw new Error(`No ${label} search libraries are configured`);
  }

  const [libraries, allUsers] = await Promise.all([
    requestJson(new URL(`${base}/Library/VirtualFolders`), headers, {
      service: label,
      operation: "load libraries",
    }),
    config.UserIds?.length
      ? Promise.resolve([])
      : requestJson(new URL(`${base}/Users`), headers, {
          service: label,
          operation: "load users",
        }),
  ]);
  const userIds = config.UserIds?.length
    ? config.UserIds
    : allUsers.map((user) => String(user.Id)).filter(Boolean);
  if (userIds.length === 0) {
    throw new Error(`No ${label} users are available for scanning`);
  }

  const targetLibraries = libraries.filter(
    (library) =>
      library.ItemId &&
      libraryNames.has(String(library.Name).toLowerCase()) &&
      !deletionLibraryNames.has(String(library.Name).toLowerCase()) &&
      /movies|tvshows|series/i.test(String(library.CollectionType || "")),
  );
  if (targetLibraries.length === 0) {
    throw new Error(
      `No configured ${label} libraries were found: ${[...libraryNames].join(", ")}`,
    );
  }

  const requests = [];
  const episodeActivityRequests = [];
  for (const library of targetLibraries) {
    const type = /movies/i.test(String(library.CollectionType))
      ? "Movie"
      : "Series";
    for (const userId of userIds) {
      const url = new URL(
        `${base}/Users/${encodeURIComponent(userId)}/Items`,
      );
      url.searchParams.set("ParentId", library.ItemId);
      url.searchParams.set("IncludeItemTypes", type);
      url.searchParams.set("Recursive", "true");
      url.searchParams.set("Limit", "10000");
      url.searchParams.set(
        "Fields",
        "Path,DateCreated,PremiereDate,ProductionYear,UserData,ProviderIds,ImageTags,Genres",
      );
      requests.push(requestJson(url, headers, {
        service: label,
        operation: `load ${type.toLowerCase()} items`,
      }));

      if (type === "Series") {
        const episodesUrl = new URL(
          `${base}/Users/${encodeURIComponent(userId)}/Items`,
        );
        episodesUrl.searchParams.set("ParentId", library.ItemId);
        episodesUrl.searchParams.set("IncludeItemTypes", "Episode");
        episodesUrl.searchParams.set("Recursive", "true");
        episodesUrl.searchParams.set("Limit", "50000");
        episodesUrl.searchParams.set("Fields", "SeriesId,UserData");
        episodeActivityRequests.push(requestJson(episodesUrl, headers, {
          service: label,
          operation: "load episode activity",
        }));
      }
    }
  }

  const [responses, episodeActivityResponses, resumeIds] = await Promise.all([
    Promise.all(requests),
    Promise.all(episodeActivityRequests),
    getResumeItemIds(base, headers, userIds, label),
  ]);
  const items = new Map();
  for (const item of responses.flatMap((response) => response.Items || [])) {
    if (!item.Id || !["Movie", "Series"].includes(item.Type)) continue;
    const merged = mergeUserItem(items.get(String(item.Id)), item);
    merged.InProgress =
      merged.InProgress ||
      (merged.Type === "Movie"
        ? resumeIds.movieIds.has(merged.ItemId)
        : resumeIds.seriesIds.has(merged.ItemId));
    items.set(String(item.Id), merged);
  }

  const episodeActivityBySeriesId = new Map();
  for (const episode of episodeActivityResponses.flatMap((response) => response.Items || [])) {
    if (!episode.Id || episode.Type !== "Episode" || !episode.SeriesId) continue;
    const seriesId = String(episode.SeriesId);
    episodeActivityBySeriesId.set(
      seriesId,
      mergeEpisodeActivity(episodeActivityBySeriesId.get(seriesId), episode),
    );
  }

  for (const [seriesId, activity] of episodeActivityBySeriesId.entries()) {
    const series = items.get(seriesId);
    if (series?.Type === "Series") {
      series.EpisodeActivity = serializeEpisodeActivity(activity);
    }
  }

  return [...items.values()];
}

async function getArrCatalog(config, endpoint) {
  if (!config?.Enabled || !config.Url || !config.ApiKey) return [];
  const url = new URL(`${trimUrl(config.Url)}${endpoint}`);
  const service = /series/i.test(endpoint) ? "Sonarr" : "Radarr";
  return requestJson(url, { "X-Api-Key": config.ApiKey }, {
    service,
    operation: "load catalog",
  });
}

function indexCatalog(items, definitions) {
  const maps = Object.fromEntries(
    definitions.map(({ name }) => [name, new Map()]),
  );
  for (const item of items) {
    for (const { name, field } of definitions) {
      if (item[field] !== undefined && item[field] !== null && item[field] !== "") {
        maps[name].set(String(item[field]).toLowerCase(), item);
      }
    }
  }
  return maps;
}

function matchCatalog(item, maps, candidates) {
  for (const [mapName, value] of candidates) {
    if (!value) continue;
    const match = maps[mapName].get(String(value).toLowerCase());
    if (match) return match;
  }
  return null;
}

export async function collectScanItems(settings) {
  const [mediaServerItems, radarrResult, sonarrResult] = await Promise.all([
    getMediaServerItems(settings),
    getArrCatalog(settings.Arrs.Radarr, "/api/v3/movie").then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    ),
    getArrCatalog(settings.Arrs.Sonarr, "/api/v3/series").then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    ),
  ]);

  const radarr = radarrResult.ok ? radarrResult.value : [];
  const sonarr = sonarrResult.ok ? sonarrResult.value : [];
  const radarrMaps = indexCatalog(radarr, [
    { name: "tmdb", field: "tmdbId" },
    { name: "imdb", field: "imdbId" },
    { name: "path", field: "path" },
  ]);
  const sonarrMaps = indexCatalog(sonarr, [
    { name: "tvdb", field: "tvdbId" },
    { name: "imdb", field: "imdbId" },
    { name: "path", field: "path" },
  ]);

  const items = mediaServerItems.map((item) => {
    const candidates = item.Type === "Movie"
      ? [
          ["tmdb", getProviderId(item.ProviderIds, "tmdb")],
          ["imdb", getProviderId(item.ProviderIds, "imdb")],
          ["path", item.Path],
        ]
      : [
          ["tvdb", getProviderId(item.ProviderIds, "tvdb")],
          ["imdb", getProviderId(item.ProviderIds, "imdb")],
          ["path", item.Path],
        ];
    const match = matchCatalog(
      item,
      item.Type === "Movie" ? radarrMaps : sonarrMaps,
      candidates,
    );

    if (!match) return item;
    return {
      ...item,
      Arr: item.Type === "Movie" ? "Radarr" : "Sonarr",
      ArrId: match.id,
      ArrDateAdded: toDateValue(match.added),
      ArrPath: match.path || null,
    };
  });

  const warnings = [];
  if (settings.Mode.DaysOlderThan > 0 && !settings.Arrs.Radarr.Enabled) {
    warnings.push(
      "Radarr is disabled. Movies need Radarr data while Minimum Arr age is enabled.",
    );
  }
  if (settings.Mode.DaysOlderThan > 0 && !settings.Arrs.Sonarr.Enabled) {
    warnings.push(
      "Sonarr is disabled. Series need Sonarr data while Minimum Arr age is enabled.",
    );
  }
  if (!radarrResult.ok && settings.Arrs.Radarr.Enabled) {
    warnings.push(`Radarr unavailable: ${radarrResult.error.message}`);
  }
  if (!sonarrResult.ok && settings.Arrs.Sonarr.Enabled) {
    warnings.push(`Sonarr unavailable: ${sonarrResult.error.message}`);
  }

  return { items, warnings };
}
