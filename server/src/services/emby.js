import { fetchExternal } from "./external-error.js";

const TIMEOUT_MS = 10000;

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

async function embyRequest(config, pathname, searchParams = {}, options = {}) {
  if (!config.ServerUrl || !config.ApiKey) {
    throw new Error("Emby URL and API key must be configured in Settings");
  }

  const url = new URL(`${trimUrl(config.ServerUrl)}${pathname}`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return fetchExternal({
    service: "Emby",
    operation: options.operation || pathname,
    url,
    timeoutMs: TIMEOUT_MS,
    options: {
      method: options.method || "GET",
      headers: {
        "X-Emby-Token": config.ApiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
  });
}

function libraryOptions() {
  return {
    EnableRealtimeMonitor: true,
    EnableMultiPartItems: true,
    PreferredMetadataLanguage: "en",
    PreferredImageLanguage: "en",
    MetadataCountryCode: "NZ",
    SaveLocalMetadata: false,
    ExcludeFromSearch: true,
    TypeOptions: [
      {
        Type: "Movie",
        MetadataFetchers: ["TheMovieDb", "The Open Movie Database", "TheTVDB"],
        ImageFetchers: ["TheMovieDb", "FanArt", "TheTVDB", "The Open Movie Database"],
        MetadataFetcherOrder: [],
        ImageFetcherOrder: [],
        ImageOptions: [],
      },
      {
        Type: "Series",
        MetadataFetchers: ["TheTVDB", "TheMovieDb", "The Open Movie Database"],
        ImageFetchers: ["TheTVDB", "TheMovieDb", "FanArt", "The Open Movie Database"],
        MetadataFetcherOrder: [],
        ImageFetcherOrder: [],
        ImageOptions: [],
      },
      {
        Type: "Episode",
        MetadataFetchers: ["TheTVDB", "TheMovieDb", "The Open Movie Database"],
        ImageFetchers: ["TheTVDB", "TheMovieDb", "FanArt", "The Open Movie Database"],
        MetadataFetcherOrder: [],
        ImageFetcherOrder: [],
        ImageOptions: [],
      },
      {
        Type: "Season",
        MetadataFetchers: ["TheTVDB", "TheMovieDb", "The Open Movie Database"],
        ImageFetchers: ["TheTVDB", "TheMovieDb", "FanArt", "The Open Movie Database"],
        MetadataFetcherOrder: [],
        ImageFetcherOrder: [],
        ImageOptions: [],
      },
      {
        Type: "Person",
        MetadataFetchers: ["TheMovieDb", "FanArt", "The Open Movie Database"],
        ImageFetchers: ["TheMovieDb", "FanArt", "The Open Movie Database"],
        MetadataFetcherOrder: [],
        ImageFetcherOrder: [],
        ImageOptions: [],
      },
    ],
  };
}

export async function getEmbyVirtualFolders(config) {
  const response = await embyRequest(config, "/Library/VirtualFolders/Query");
  const data = await response.json();
  return Array.isArray(data.Items) ? data.Items : Array.isArray(data) ? data : [];
}

export async function ensureEmbyVirtualFolder(config, { name, collectionType, folderPath }) {
  const folders = await getEmbyVirtualFolders(config);
  const existing = folders.find((folder) => String(folder.Name) === name);
  if (existing) {
    return { name, created: false, existing: true };
  }

  await embyRequest(config, "/Library/VirtualFolders", {}, {
    method: "POST",
    body: {
      Name: name,
      CollectionType: collectionType,
      RefreshLibrary: true,
      Paths: [folderPath],
      LibraryOptions: libraryOptions(),
    },
  });

  return { name, created: true, existing: false };
}

export async function deleteEmbyVirtualFolder(config, { id }) {
  if (!id) throw new Error("Emby library id is required");
  await embyRequest(config, "/Library/VirtualFolders/Delete", {}, {
    method: "POST",
    body: {
      Id: id,
      RefreshLibrary: false,
    },
  });
}

export async function refreshEmbyLibrary(config) {
  await embyRequest(config, "/Library/Refresh", {}, {
    method: "POST",
    operation: "Library refresh",
  });
}

export async function refreshEmbyLibraryItem(config, itemId) {
  if (!itemId) throw new Error("Emby library item id is required");
  await embyRequest(
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

export async function getEmbyLibraryScanStatus(config) {
  try {
    const response = await embyRequest(config, "/ScheduledTasks", {}, {
      operation: "Library scan status",
    });
    const tasks = await response.json();
    const task = (Array.isArray(tasks) ? tasks : []).find((item) =>
      String(item?.Key || "").toLowerCase() === "refreshlibrary" ||
      String(item?.Name || "").toLowerCase() === "scan media library"
    );
    const rawProgress = task?.CurrentProgressPercentage;
    const progress = rawProgress === null || rawProgress === undefined
      ? null
      : Number(rawProgress);
    return {
      available: true,
      inProgress: String(task?.State || "").toLowerCase() === "running",
      progress: Number.isFinite(progress) ? progress : null,
    };
  } catch {
    return { available: false, inProgress: false, progress: null };
  }
}

export async function getEmbyLibraryItemCount(config, itemId, { includeItemTypes } = {}) {
  if (!itemId) throw new Error("Emby library item id is required");
  const response = await embyRequest(config, "/Items", {
    ParentId: itemId,
    Recursive: true,
    IncludeItemTypes: includeItemTypes,
    Limit: 0,
  });
  const data = await response.json();
  return Number(data.TotalRecordCount || 0);
}

async function firstUserId(config) {
  if (Array.isArray(config.UserIds) && config.UserIds[0]) {
    return String(config.UserIds[0]);
  }
  const response = await embyRequest(config, "/Users");
  const users = await response.json();
  const userId = Array.isArray(users) ? users[0]?.Id : null;
  if (!userId) throw new Error("No Emby users are available");
  return String(userId);
}

export async function getEmbyItemMediaPath(config, itemId) {
  const userId = await firstUserId(config);
  const response = await embyRequest(
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

export async function getEmbySeriesEpisodes(config, seriesId) {
  const userId = await firstUserId(config);
  const response = await embyRequest(
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

export async function searchEmby(config, term) {
  const libraryNames = Array.isArray(config.SearchLibraries)
    ? config.SearchLibraries
    : [];
  if (libraryNames.length === 0) {
    throw new Error("No Emby search libraries are configured");
  }

  const librariesResponse = await embyRequest(config, "/Library/VirtualFolders");
  const libraries = await librariesResponse.json();
  const allowedNames = new Set(libraryNames.map((name) => name.toLowerCase()));
  const allowedLibraries = libraries.filter(
    (library) =>
      library.ItemId && allowedNames.has(String(library.Name).toLowerCase()),
  );

  if (allowedLibraries.length === 0) {
    throw new Error(
      `No configured Emby libraries were found: ${libraryNames.join(", ")}`,
    );
  }

  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const response = await embyRequest(config, "/Items", {
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
    if (!unique.has(key)) {
      unique.set(key, {
        ItemId: String(item.Id),
        Title: String(item.Name || "Untitled"),
        Type: item.Type,
        Year: Number.isInteger(item.ProductionYear)
          ? item.ProductionYear
          : null,
        ProviderIds:
          item.ProviderIds && typeof item.ProviderIds === "object"
            ? item.ProviderIds
            : {},
        HasPrimaryImage: Boolean(item.ImageTags?.Primary),
      });
    }
  }

  return [...unique.values()].sort((left, right) =>
    left.Title.localeCompare(right.Title, undefined, { sensitivity: "base" }),
  );
}

export async function getEmbyItemsByIds(config, itemIds) {
  const ids = [...new Set(itemIds.map(String).filter(Boolean))];
  if (ids.length === 0) return [];

  const response = await embyRequest(config, "/Items", {
    Ids: ids.join(","),
    Fields: "ProductionYear,ProviderIds,ImageTags,Path",
    Limit: ids.length,
  });
  const data = await response.json();
  return (data.Items || [])
    .filter((item) => item.Id && ["Movie", "Series"].includes(item.Type))
    .map((item) => ({
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
    }));
}

export async function getEmbyUsers(config) {
  const response = await embyRequest(config, "/Users");
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

function embyViewKey(view) {
  return String(
    view?.PresentationUniqueKey || view?.Guid || view?.Id || "",
  ).trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildEmbyLeavingSoonUserConfiguration({
  configuration,
  views,
  movieLibraryName,
  seriesLibraryName,
  primaryLibraryNames = [],
  keepTogether = true,
  includeInSecondarySections = false,
}) {
  const current = configuration && typeof configuration === "object"
    ? configuration
    : {};
  const availableViews = Array.isArray(views) ? views : [];
  const viewsByName = new Map(
    availableViews.map((view) => [String(view?.Name || "").trim().toLowerCase(), view]),
  );
  const movieKey = embyViewKey(
    viewsByName.get(String(movieLibraryName || "").trim().toLowerCase()),
  );
  const seriesKey = embyViewKey(
    viewsByName.get(String(seriesLibraryName || "").trim().toLowerCase()),
  );
  const managedKeys = [movieKey, seriesKey].filter(Boolean);

  if (managedKeys.length === 0) {
    return { changed: false, configuration: current, managedKeys: [] };
  }

  const next = structuredClone(current);
  const currentOrder = uniqueStrings(current.OrderedViews);
  let nextOrder = currentOrder;

  if (keepTogether) {
    const fallbackOrder = uniqueStrings(availableViews.map(embyViewKey));
    const baseOrder = currentOrder.length > 0 ? currentOrder : fallbackOrder;
    const managed = new Set(managedKeys);
    const withoutManaged = baseOrder.filter((key) => !managed.has(key));
    const preferredKeys = primaryLibraryNames
      .map((name) => embyViewKey(
        viewsByName.get(String(name || "").trim().toLowerCase()),
      ))
      .filter(Boolean);
    const preferredPositions = preferredKeys
      .map((key) => withoutManaged.indexOf(key))
      .filter((index) => index >= 0);
    const originalPositions = managedKeys
      .map((key) => baseOrder.indexOf(key))
      .filter((index) => index >= 0);
    const insertionIndex = preferredPositions.length > 0
      ? Math.max(...preferredPositions) + 1
      : Math.min(...originalPositions, withoutManaged.length);
    nextOrder = [
      ...withoutManaged.slice(0, insertionIndex),
      ...managedKeys,
      ...withoutManaged.slice(insertionIndex),
    ];
    next.OrderedViews = nextOrder;
  }

  const currentExcludes = uniqueStrings(current.LatestItemsExcludes);
  const managed = new Set(managedKeys);
  const nextExcludes = includeInSecondarySections
    ? currentExcludes.filter((key) => !managed.has(key))
    : uniqueStrings([...currentExcludes, ...managedKeys]);
  next.LatestItemsExcludes = nextExcludes;

  return {
    changed:
      !arraysEqual(currentOrder, nextOrder) ||
      !arraysEqual(currentExcludes, nextExcludes),
    configuration: next,
    managedKeys,
  };
}

async function getEmbyUser(config, userId) {
  const response = await embyRequest(config, `/Users/${encodeURIComponent(userId)}`);
  return response.json();
}

async function getEmbyUserViews(config, userId) {
  const response = await embyRequest(config, `/Users/${encodeURIComponent(userId)}/Views`);
  const data = await response.json();
  return Array.isArray(data?.Items) ? data.Items : [];
}

async function updateEmbyUserConfiguration(config, userId, configuration) {
  await embyRequest(config, `/Users/${encodeURIComponent(userId)}/Configuration`, {}, {
    method: "POST",
    body: configuration,
    operation: "update user home screen preferences",
  });
}

export async function syncEmbyLeavingSoonUserPreferences(config, {
  movieLibraryName,
  seriesLibraryName,
  keepTogether = true,
  includeInSecondarySections = false,
} = {}) {
  const folders = await getEmbyVirtualFolders(config);
  const targetNames = new Set([
    String(movieLibraryName || "").trim().toLowerCase(),
    String(seriesLibraryName || "").trim().toLowerCase(),
  ].filter(Boolean));
  const hasAvailableTarget = folders.some((folder) =>
    targetNames.has(String(folder?.Name || "").trim().toLowerCase()) &&
    String(folder?.Guid || "").trim()
  );
  if (!hasAvailableTarget) {
    return { supported: true, updated: 0, unchanged: 0, skipped: 0, reason: "no-libraries" };
  }

  const users = await getEmbyUsers(config);
  const applied = [];
  let unchanged = 0;
  let skipped = 0;

  try {
    for (const user of users) {
      const [record, views] = await Promise.all([
        getEmbyUser(config, user.id),
        getEmbyUserViews(config, user.id),
      ]);
      const original = record?.Configuration && typeof record.Configuration === "object"
        ? structuredClone(record.Configuration)
        : null;
      if (!original) {
        skipped += 1;
        continue;
      }
      const update = buildEmbyLeavingSoonUserConfiguration({
        configuration: original,
        views,
        movieLibraryName,
        seriesLibraryName,
        primaryLibraryNames: config.SearchLibraries,
        keepTogether,
        includeInSecondarySections,
      });
      if (!update.changed) {
        unchanged += 1;
        continue;
      }
      await updateEmbyUserConfiguration(config, user.id, update.configuration);
      applied.push({ id: user.id, original });
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...applied].reverse()) {
      try {
        await updateEmbyUserConfiguration(config, entry.id, entry.original);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    const suffix = rollbackErrors.length > 0
      ? ` Rollback warnings: ${rollbackErrors.join("; ")}`
      : " Previous user changes were rolled back.";
    throw new Error(
      `Emby home screen preferences could not be synchronized: ${error.message}.${suffix}`,
    );
  }

  return {
    supported: true,
    updated: applied.length,
    unchanged,
    skipped,
  };
}

function activeMediaPath(item = {}) {
  const mediaSourcePath = Array.isArray(item.MediaSources)
    ? item.MediaSources.find((source) => source?.Path)?.Path
    : null;
  return mediaSourcePath || item.Path || null;
}

export async function getEmbyActiveSessions(config) {
  const response = await embyRequest(config, "/Sessions", {}, {
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
      seriesTitle: String(session.NowPlayingItem.SeriesName || ""),
      type: String(session.NowPlayingItem.Type || ""),
      title: String(session.NowPlayingItem.Name || "Unknown media"),
      year: Number(session.NowPlayingItem.ProductionYear) || null,
      mediaPath: activeMediaPath(session.NowPlayingItem),
      paused: session.PlayState?.IsPaused === true,
    }));
}

export async function getEmbyGenres(config) {
  const libraryNames = Array.isArray(config.SearchLibraries)
    ? config.SearchLibraries
    : [];
  if (libraryNames.length === 0) {
    throw new Error("No Emby search libraries are configured");
  }

  const librariesResponse = await embyRequest(config, "/Library/VirtualFolders");
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
      `No configured Emby libraries were found: ${libraryNames.join(", ")}`,
    );
  }

  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const response = await embyRequest(config, "/Items", {
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

export async function getEmbyMediaOverview(config) {
  const libraryNames = Array.isArray(config.SearchLibraries)
    ? config.SearchLibraries
    : [];
  if (libraryNames.length === 0) {
    throw new Error("No Emby search libraries are configured");
  }

  const librariesResponse = await embyRequest(config, "/Library/VirtualFolders");
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
      `No configured Emby libraries were found: ${libraryNames.join(", ")}`,
    );
  }

  const responses = await Promise.all(
    allowedLibraries.map(async (library) => {
      const type = /movies/i.test(String(library.CollectionType))
        ? "Movie"
        : "Series";
      const response = await embyRequest(config, "/Items", {
        ParentId: library.ItemId,
        Recursive: true,
        IncludeItemTypes: type,
        Fields: "Path",
        Limit: 10000,
      });
      const episodeData = type === "Series"
        ? await embyRequest(config, "/Items", {
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

export async function fetchEmbyPrimaryImage(config, itemId) {
  return embyRequest(
    config,
    `/Items/${encodeURIComponent(itemId)}/Images/Primary`,
    { maxWidth: 300, quality: 85 },
  );
}
