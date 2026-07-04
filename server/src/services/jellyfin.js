import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 10000;

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function jellyfinAuthorization(config) {
  return `MediaBrowser Client="Scrubarr", Device="Scrubarr", DeviceId="scrubarr", Version="0.0.0", Token="${config.ApiKey}"`;
}

export function jellyfinHeaders(config, { json = false } = {}) {
  return {
    Authorization: jellyfinAuthorization(config),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function jellyfinRequest(config, pathname, searchParams = {}, options = {}) {
  if (!config.ServerUrl || !config.ApiKey) {
    throw new Error("Jellyfin URL and API key must be configured in Settings");
  }

  const url = new URL(`${trimUrl(config.ServerUrl)}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(key, String(item));
        }
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  return fetchExternal({
    service: "Jellyfin",
    operation: options.operation || pathname,
    url,
    timeoutMs: TIMEOUT_MS,
    options: {
      method: options.method || "GET",
      headers: jellyfinHeaders(config, { json: Boolean(options.body) }),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
  });
}

function libraryOptions() {
  return {
    EnableRealtimeMonitor: true,
    SaveLocalMetadata: false,
    ExcludeFromSearch: true,
    EnableChapterImageExtraction: false,
    ExtractChapterImagesDuringLibraryScan: false,
  };
}

export async function getJellyfinVirtualFolders(config) {
  const response = await jellyfinRequest(config, "/Library/VirtualFolders");
  const data = await response.json();
  return Array.isArray(data.Items) ? data.Items : Array.isArray(data) ? data : [];
}

export async function ensureJellyfinVirtualFolder(config, { name, collectionType, folderPath }) {
  const folders = await getJellyfinVirtualFolders(config);
  const existing = folders.find((folder) => String(folder.Name) === name);
  if (existing) {
    return { name, created: false, existing: true };
  }

  await jellyfinRequest(
    config,
    "/Library/VirtualFolders",
    {
      name,
      collectionType,
      paths: [folderPath],
      refreshLibrary: true,
    },
    {
      method: "POST",
      body: libraryOptions(),
    },
  );

  return { name, created: true, existing: false };
}

export async function deleteJellyfinVirtualFolder(config, { name }) {
  if (!name) throw new Error("Jellyfin library name is required");
  await jellyfinRequest(
    config,
    "/Library/VirtualFolders",
    { name, refreshLibrary: false },
    { method: "DELETE" },
  );
}

export async function refreshJellyfinLibrary(config) {
  await jellyfinRequest(config, "/Library/Refresh", {}, {
    method: "POST",
    operation: "Library refresh",
  });
}

export async function refreshJellyfinLibraryItem(config, itemId) {
  if (!itemId) throw new Error("Jellyfin library item id is required");
  await jellyfinRequest(
    config,
    `/Items/${encodeURIComponent(itemId)}/Refresh`,
    {
      Recursive: true,
      MetadataRefreshMode: "Default",
      ImageRefreshMode: "Default",
      ReplaceAllMetadata: false,
      ReplaceAllImages: false,
    },
    {
      method: "POST",
      operation: "Library item refresh",
    },
  );
}

export async function getJellyfinLibraryItemCount(config, itemId) {
  if (!itemId) throw new Error("Jellyfin library item id is required");
  const response = await jellyfinRequest(config, "/Items", {
    ParentId: itemId,
    Recursive: true,
    Limit: 0,
  });
  const data = await response.json();
  return Number(data.TotalRecordCount || 0);
}

async function firstUserId(config) {
  if (Array.isArray(config.UserIds) && config.UserIds[0]) {
    return String(config.UserIds[0]);
  }
  const response = await jellyfinRequest(config, "/Users");
  const users = await response.json();
  const userId = Array.isArray(users) ? users[0]?.Id : null;
  if (!userId) throw new Error("No Jellyfin users are available");
  return String(userId);
}

export async function getJellyfinItemMediaPath(config, itemId) {
  const userId = await firstUserId(config);
  const response = await jellyfinRequest(
    config,
    `/Users/${encodeURIComponent(userId)}/Items/${encodeURIComponent(itemId)}`,
    { Fields: "Path,MediaSources" },
  );
  const item = await response.json();
  const mediaSourcePath = Array.isArray(item.MediaSources)
    ? item.MediaSources.find((source) => source?.Path)?.Path
    : null;
  return mediaSourcePath || item.Path || null;
}

export async function getJellyfinSeriesEpisodes(config, seriesId) {
  const userId = await firstUserId(config);
  const response = await jellyfinRequest(
    config,
    `/Shows/${encodeURIComponent(seriesId)}/Episodes`,
    {
      UserId: userId,
      Fields: "Path,ParentIndexNumber,IndexNumber,SeasonName",
      Limit: 10000,
    },
  );
  const data = await response.json();
  return Array.isArray(data.Items) ? data.Items : [];
}

async function configuredLibraries(config) {
  const libraryNames = Array.isArray(config.SearchLibraries)
    ? config.SearchLibraries
    : [];
  if (libraryNames.length === 0) {
    throw new Error("No Jellyfin search libraries are configured");
  }

  const librariesResponse = await jellyfinRequest(config, "/Library/VirtualFolders");
  const libraries = await librariesResponse.json();
  const allowedNames = new Set(libraryNames.map((name) => name.toLowerCase()));
  const allowedLibraries = libraries.filter(
    (library) =>
      library.ItemId &&
      allowedNames.has(String(library.Name).toLowerCase()) &&
      /movies|tvshows|series/i.test(String(library.CollectionType || "")),
  );

  if (allowedLibraries.length === 0) {
    throw new Error(
      `No configured Jellyfin libraries were found: ${libraryNames.join(", ")}`,
    );
  }

  return allowedLibraries;
}

function mapMediaItem(item) {
  return {
    ItemId: String(item.Id),
    Title: String(item.Name || "Untitled"),
    Type: item.Type,
    Year: Number.isInteger(item.ProductionYear)
      ? item.ProductionYear
      : null,
    Path: item.Path || null,
    ProviderIds:
      item.ProviderIds && typeof item.ProviderIds === "object"
        ? item.ProviderIds
        : {},
    HasPrimaryImage: Boolean(item.ImageTags?.Primary),
  };
}

export async function searchJellyfin(config, term) {
  const allowedLibraries = await configuredLibraries(config);
  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const response = await jellyfinRequest(config, "/Items", {
        ParentId: library.ItemId,
        SearchTerm: term,
        Recursive: true,
        IncludeItemTypes: "Movie,Series",
        Fields: "ProductionYear,ProviderIds,ImageTags",
        Limit: 100,
      });
      return response.json();
    }),
  );

  const unique = new Map();
  for (const item of responses.flatMap((response) => response.Items || [])) {
    if (!item.Id || !["Movie", "Series"].includes(item.Type)) continue;
    const key = `${item.Type}|${item.Id}`;
    if (!unique.has(key)) unique.set(key, mapMediaItem(item));
  }

  return [...unique.values()].sort((left, right) =>
    left.Title.localeCompare(right.Title, undefined, { sensitivity: "base" }),
  );
}

export async function getJellyfinItemsByIds(config, itemIds) {
  const ids = [...new Set(itemIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  const response = await jellyfinRequest(config, "/Items", {
    Ids: ids.join(","),
    Fields: "ProductionYear,ProviderIds,ImageTags,Path",
    Limit: ids.length,
  });
  const data = await response.json();
  return (data.Items || [])
    .filter((item) => item.Id && ["Movie", "Series"].includes(item.Type))
    .map(mapMediaItem);
}

export async function getJellyfinUsers(config) {
  const response = await jellyfinRequest(config, "/Users");
  const users = await response.json();
  return users
    .filter((user) => user.Id)
    .map((user) => ({
      id: String(user.Id),
      name: String(user.Name || user.Id),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}

export async function getJellyfinActiveSessions(config) {
  const response = await jellyfinRequest(config, "/Sessions", {}, {
    operation: "load active playback sessions",
  });
  const sessions = await response.json();
  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => session.NowPlayingItem?.Id)
    .map((session) => ({
      id: String(session.Id || ""),
      userName: String(session.UserName || session.UserId || "Unknown user"),
      client: String(session.Client || ""),
      deviceName: String(session.DeviceName || ""),
      itemId: String(session.NowPlayingItem.Id),
      seriesId: session.NowPlayingItem.SeriesId
        ? String(session.NowPlayingItem.SeriesId)
        : null,
      type: String(session.NowPlayingItem.Type || ""),
      title: String(session.NowPlayingItem.Name || "Unknown media"),
      paused: session.PlayState?.IsPaused === true,
    }));
}

export async function getJellyfinGenres(config) {
  const allowedLibraries = await configuredLibraries(config);
  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const response = await jellyfinRequest(config, "/Items", {
        ParentId: library.ItemId,
        Recursive: true,
        IncludeItemTypes: "Movie,Series",
        Fields: "Genres",
        Limit: 10000,
      });
      return response.json();
    }),
  );

  const genres = new Set();
  for (const item of responses.flatMap((response) => response.Items || [])) {
    for (const genre of item.Genres || []) {
      const trimmed = String(genre).trim();
      if (trimmed) genres.add(trimmed);
    }
  }

  return [...genres].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

export async function getJellyfinMediaOverview(config) {
  const allowedLibraries = await configuredLibraries(config);
  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const type = /movies/i.test(String(library.CollectionType))
        ? "Movie"
        : "Series";
      const response = await jellyfinRequest(config, "/Items", {
        ParentId: library.ItemId,
        Recursive: true,
        IncludeItemTypes: type,
        Fields: "Path",
        Limit: 10000,
      });
      const episodeData = type === "Series"
        ? await jellyfinRequest(config, "/Items", {
            ParentId: library.ItemId,
            Recursive: true,
            IncludeItemTypes: "Episode",
            Limit: 1,
          }).then((episodeResponse) => episodeResponse.json())
        : null;
      return {
        type,
        data: await response.json(),
        episodeData,
      };
    }),
  );

  const items = [];
  let movies = 0;
  let series = 0;
  let episodes = 0;
  for (const { type, data, episodeData } of responses) {
    const count = Number(data.TotalRecordCount ?? data.Items?.length ?? 0);
    if (type === "Movie") movies += count;
    if (type === "Series") {
      series += count;
      episodes += Number(
        episodeData?.TotalRecordCount ?? episodeData?.Items?.length ?? 0,
      );
    }

    for (const item of data.Items || []) {
      if (!item.Id || !["Movie", "Series"].includes(item.Type)) continue;
      items.push({
        ItemId: String(item.Id),
        Title: String(item.Name || "Untitled"),
        Type: item.Type,
        Path: item.Path || null,
      });
    }
  }

  return {
    media: {
      movies,
      series,
      episodes,
      total: movies + series,
    },
    items,
  };
}

export async function fetchJellyfinPrimaryImage(config, itemId) {
  return jellyfinRequest(
    config,
    `/Items/${encodeURIComponent(itemId)}/Images/Primary`,
    { maxWidth: 300, quality: 85 },
  );
}
