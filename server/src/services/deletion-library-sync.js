import fs from "node:fs/promises";
import path from "node:path";
import {
  deleteMediaServerVirtualFolder,
  ensureMediaServerVirtualFolder,
  getMediaServerItemMediaPath,
  getMediaServerItemsByIds,
  getMediaServerSeriesEpisodes,
  getMediaServerVirtualFolders,
  mediaServerConfig,
  mediaServerLabel,
  refreshMediaServerLibrary,
} from "./media-server.js";
import { createPendingRecords, formatDateInTimezone } from "./pending-queue.js";
import { activePendingItems } from "./pending-state.js";

const MANIFEST_NAME = ".scrubarr-links.json";
const STRM_EXTENSION = ".strm";
const EMPTY_QUEUE_IGNORE_NAMES = new Set(["desktop.ini", ".ds_store", MANIFEST_NAME]);
const EMPTY_QUEUE_ARTIFACT_NAMES = new Set([
  "backdrop.jpg",
  "backdrops",
  "clearlogo.png",
  "fanart.jpg",
  "folder.jpg",
  "landscape.jpg",
  "logo.png",
  "poster.jpg",
  "theme.mp3",
  "theme.mp4",
]);

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function queuePathFor(settings, type) {
  const config = mediaServerConfig(settings);
  const queueWritePaths = config.QueueWritePaths || {};
  const writePath = type === "Movie"
    ? queueWritePaths.Movies
    : queueWritePaths.Series;
  if (String(writePath || "").trim()) return writePath;
  return type === "Movie"
    ? config.ToBeDeletedPaths.Movies
    : config.ToBeDeletedPaths.Series;
}

function mediaServerPathFor(settings, type) {
  const config = mediaServerConfig(settings);
  return type === "Movie"
    ? config.ToBeDeletedPaths.Movies
    : config.ToBeDeletedPaths.Series;
}

function deletionLibraryNameFor(settings, type) {
  const config = mediaServerConfig(settings);
  return type === "Movie"
    ? config.DeletionLibraries.Movies
    : config.DeletionLibraries.Series;
}

function canManageMediaServerLibraries(settings) {
  const config = mediaServerConfig(settings);
  return Boolean(config.ServerUrl && config.ApiKey);
}

function isHostOnlyWindowsPath(value) {
  return process.platform !== "win32" && /^[A-Za-z]:[\\/]/.test(String(value || ""));
}

function sanitizeName(value) {
  return String(value || "Untitled")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(item) {
  const title = sanitizeName(item.Title);
  if (!item.Year || title.includes(`(${item.Year})`)) return title;
  return `${title} (${item.Year})`;
}

function itemKey(type, itemId) {
  return `${type}|${String(itemId)}`;
}

function metadataFromManagedPath(entryPath, type) {
  const rawName = type === "Movie"
    ? path.basename(entryPath, STRM_EXTENSION)
    : path.basename(entryPath);
  const yearMatch = rawName.match(/\((\d{4})\)\s*$/);
  return {
    title: sanitizeName(rawName.replace(/\s*\(\d{4}\)\s*$/, "")) || rawName,
    year: yearMatch ? Number(yearMatch[1]) : null,
  };
}

function manifestPath(directory, type) {
  return path.join(directory, `deletion-library-${type.toLowerCase()}.json`);
}

async function readJsonFile(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function readManifest({ baseDirectory, manifestDirectory, type }) {
  const primary = await readJsonFile(manifestPath(manifestDirectory, type));
  if (Object.keys(primary).length > 0) return primary;
  return readJsonFile(path.join(baseDirectory, MANIFEST_NAME));
}

export async function currentManifestEntries({ settings, manifestDirectory }) {
  const result = [];
  for (const type of ["Movie", "Series"]) {
    const baseDirectory = queuePathFor(settings, type);
    if (!baseDirectory) continue;
    const manifest = await readManifest({ baseDirectory, manifestDirectory, type });
    for (const [itemId, entry] of Object.entries(manifest)) {
      if (!entry?.path) continue;
      if (!isInsideDirectory(entry.path, baseDirectory)) continue;
      if (!(await isRealPathInsideDirectory(entry.path, baseDirectory))) continue;
      const stat = await fs.lstat(entry.path).catch(() => null);
      if (!stat) continue;
      result.push({ type, itemId: String(itemId), entry });
    }
  }
  return result;
}

async function writeManifest({ manifestDirectory, type, manifest }) {
  await fs.mkdir(manifestDirectory, { recursive: true });
  await fs.writeFile(
    manifestPath(manifestDirectory, type),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function isInsideDirectory(candidatePath, baseDirectory) {
  const resolvedBase = path.resolve(baseDirectory);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function isRealPathInsideDirectory(candidatePath, baseDirectory) {
  if (!isInsideDirectory(candidatePath, baseDirectory)) return false;
  try {
    const [realBase, realCandidate] = await Promise.all([
      fs.realpath(baseDirectory),
      fs.realpath(candidatePath),
    ]);
    return isInsideDirectory(realCandidate, realBase);
  } catch {
    return false;
  }
}

async function removeManagedEntry(entryPath, baseDirectory) {
  if (!isInsideDirectory(entryPath, baseDirectory)) {
    throw new Error("Managed entry path is outside the queue path.");
  }
  if (!(await isRealPathInsideDirectory(entryPath, baseDirectory))) {
    throw new Error("Managed entry path does not resolve inside the queue path.");
  }
  await fs.rm(entryPath, { recursive: true, force: true });
}

async function removeLegacyQueueManifest(directory) {
  await fs.rm(path.join(directory, MANIFEST_NAME), { force: true }).catch(() => {});
}

async function pruneEmptyQueueArtifacts(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!EMPTY_QUEUE_ARTIFACT_NAMES.has(entry.name.toLowerCase())) continue;
    await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

async function emptyQueueDirectoryState(directory) {
  try {
    const artifactsRemoved = await pruneEmptyQueueArtifacts(directory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const visibleEntries = entries.filter(
      (entry) => !EMPTY_QUEUE_IGNORE_NAMES.has(entry.name.toLowerCase()),
    );
    return {
      empty: visibleEntries.length === 0,
      count: visibleEntries.length,
      artifactsRemoved,
      message: "",
    };
  } catch (error) {
    return {
      empty: false,
      count: null,
      artifactsRemoved: 0,
      message: error.message,
    };
  }
}

function strmFileName(value) {
  return `${sanitizeName(value)}${STRM_EXTENSION}`;
}

function episodeFileName(episode) {
  const season = Number(episode.ParentIndexNumber || 0);
  const episodeNumber = Number(episode.IndexNumber || 0);
  const prefix = season > 0 && episodeNumber > 0
    ? `S${String(season).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")} - `
    : "";
  return strmFileName(`${prefix}${episode.Name || episode.Id || "Episode"}`);
}

async function canReplacePath(entryPath, manifestEntry) {
  const existing = await fs.lstat(entryPath).catch(() => null);
  if (!existing) return true;
  return manifestEntry?.path === entryPath;
}

async function writeStrmFile(filePath, target) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${target}\n`, "utf8");
}

async function ensureQueueDirectory(directory) {
  if (!directory) {
    return { ok: false, message: "Queue path is not configured." };
  }
  if (isHostOnlyWindowsPath(directory)) {
    return {
      ok: false,
      message:
        "Queue write path is a Windows host path. In Docker, set the queue write path to a mounted container path such as /queue/movies or /queue/series.",
    };
  }
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.access(directory);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function ensureMovieEntry({ item, settings, baseDirectory, manifest }) {
  const target = await getMediaServerItemMediaPath(settings, item.ItemId);
  if (!target) return { linked: false, skipped: true, message: "Missing movie media path." };
  const name = displayName(item);
  const linkPath = path.join(baseDirectory, strmFileName(name));
  const manifestEntry = manifest[item.ItemId];
  if (!(await canReplacePath(linkPath, manifestEntry))) {
    return {
      linked: false,
      skipped: true,
      message: "A non-managed file or folder already exists at the queue path.",
    };
  }

  try {
    if (manifestEntry?.path === linkPath) {
      const current = await fs.readFile(linkPath, "utf8").catch(() => "");
      if (current.trim() === target) {
        manifest[item.ItemId] = { path: linkPath, target, mode: "strm" };
        return { linked: false, skipped: false, existing: true };
      }
    }
    if (manifestEntry?.path) await removeManagedEntry(manifestEntry.path, baseDirectory);
    await writeStrmFile(linkPath, target);
    manifest[item.ItemId] = { path: linkPath, target, mode: "strm" };
    return { linked: true, skipped: false };
  } catch (error) {
    return { linked: false, skipped: true, message: error.message };
  }
}

async function ensureSeriesEntry({ item, settings, baseDirectory, manifest }) {
  const episodes = await getMediaServerSeriesEpisodes(settings, item.ItemId);
  const playableEpisodes = episodes.filter((episode) => episode.Path);
  if (playableEpisodes.length === 0) {
    return { linked: false, skipped: true, message: "No episode media paths found." };
  }
  const seriesDirectory = path.join(baseDirectory, displayName(item));
  const manifestEntry = manifest[item.ItemId];
  if (!(await canReplacePath(seriesDirectory, manifestEntry))) {
    return {
      linked: false,
      skipped: true,
      message: "A non-managed file or folder already exists at the queue path.",
    };
  }

  try {
    if (manifestEntry?.path) await removeManagedEntry(manifestEntry.path, baseDirectory);
    await fs.mkdir(seriesDirectory, { recursive: true });
    for (const episode of playableEpisodes) {
      const season = Number(episode.ParentIndexNumber || 0);
      const seasonDirectory = season > 0
        ? path.join(seriesDirectory, `Season ${String(season).padStart(2, "0")}`)
        : seriesDirectory;
      await writeStrmFile(path.join(seasonDirectory, episodeFileName(episode)), episode.Path);
    }
    manifest[item.ItemId] = {
      path: seriesDirectory,
      target: item.Path,
      mode: "strm-series",
      episodes: playableEpisodes.length,
    };
    return { linked: true, skipped: false };
  } catch (error) {
    return { linked: false, skipped: true, message: error.message };
  }
}

async function syncType({ type, items, settings, manifestDirectory }) {
  const directory = queuePathFor(settings, type);
  const mediaServerDirectory = mediaServerPathFor(settings, type);
  const directoryState = await ensureQueueDirectory(directory);
  const summary = {
    type,
    queuePath: directory,
    embyPath: mediaServerDirectory,
    linksCreated: 0,
    linksExisting: 0,
    linksRemoved: 0,
    skipped: [],
    writable: directoryState.ok,
    message: directoryState.message || "",
  };

  if (!directoryState.ok) return summary;

  const manifest = await readManifest({
    baseDirectory: directory,
    manifestDirectory,
    type,
  });
  const expectedIds = new Set(items.map((item) => String(item.ItemId)));

  for (const [itemId, entry] of Object.entries(manifest)) {
    if (expectedIds.has(String(itemId)) || !entry?.path) continue;
    try {
      await removeManagedEntry(entry.path, directory);
      delete manifest[itemId];
      summary.linksRemoved += 1;
    } catch (error) {
      summary.skipped.push({ title: itemId, reason: error.message });
    }
  }

  for (const item of items) {
    const result = item.Type === "Series"
      ? await ensureSeriesEntry({ item, settings, baseDirectory: directory, manifest })
      : await ensureMovieEntry({ item, settings, baseDirectory: directory, manifest });
    if (result.linked) summary.linksCreated += 1;
    else if (result.existing) summary.linksExisting += 1;
    else if (result.skipped) {
      summary.skipped.push({ title: item.Title, reason: result.message });
    }
  }

  await writeManifest({ manifestDirectory, type, manifest });
  await removeLegacyQueueManifest(directory);
  return summary;
}

async function removeEmptyDeletionLibraries({ settings, countsByType, links }) {
  const result = {
    removed: [],
    skipped: [],
  };

  if (!canManageMediaServerLibraries(settings)) return result;

  const folders = await getMediaServerVirtualFolders(settings);

  for (const type of ["Movie", "Series"]) {
    if (Number(countsByType[type] || 0) > 0) continue;

    const libraryName = deletionLibraryNameFor(settings, type);
    const folder = folders.find((item) => String(item.Name) === libraryName);
    const folderId = folder?.ItemId || folder?.Id || null;
    if (!folder) continue;

    const link = links.find((item) => item.type === type);
    if (!link?.writable) {
      result.skipped.push({
        type,
        name: libraryName,
        reason: link?.message || "Queue path is not writable.",
      });
      continue;
    }

    const queueState = await emptyQueueDirectoryState(link.queuePath);
    if (!queueState.empty) {
      result.skipped.push({
        type,
        name: libraryName,
        reason: queueState.message ||
          `Queue path still contains ${queueState.count} item(s).`,
      });
      continue;
    }

    await deleteMediaServerVirtualFolder(settings, { id: folderId, name: libraryName });
    result.removed.push({
      type,
      name: libraryName,
      id: String(folderId || libraryName),
    });
  }

  return result;
}

export async function syncDeletionLibraries({ settings, pending, manifestDirectory = "./data/library-sync" }) {
  const activeConfig = mediaServerConfig(settings);
  const label = mediaServerLabel(settings);
  if (activeConfig.CreateDeletionLibraries !== true) {
    return {
      enabled: false,
      provider: label,
      message: `Create ${label} deletion libraries is disabled.`,
      libraries: [],
      links: [],
      refreshed: false,
    };
  }

  const active = activePendingItems(pending);
  const movies = active.filter((item) => item.Type === "Movie");
  const series = active.filter((item) => item.Type === "Series");

  if (active.length === 0) {
    const links = [
      await syncType({ type: "Movie", items: [], settings, manifestDirectory }),
      await syncType({ type: "Series", items: [], settings, manifestDirectory }),
    ];
    const emptyLibraries = await removeEmptyDeletionLibraries({
      settings,
      countsByType: { Movie: 0, Series: 0 },
      links,
    });
    const removedLinks = links.reduce(
      (total, link) => total + Number(link.linksRemoved || 0),
      0,
    );
    const removedLibraries = emptyLibraries.removed.length;
    if (removedLinks > 0 || removedLibraries > 0) await refreshMediaServerLibrary(settings);
    return {
      enabled: true,
      provider: label,
      message: "No pending items to sync.",
      libraries: [],
      librariesRemoved: emptyLibraries.removed,
      libraryRemovalSkipped: emptyLibraries.skipped,
      links,
      pending: 0,
      refreshed: removedLinks > 0 || removedLibraries > 0,
    };
  }

  const links = [
    await syncType({ type: "Movie", items: movies, settings, manifestDirectory }),
    await syncType({ type: "Series", items: series, settings, manifestDirectory }),
  ];

  const movieLink = links.find((item) => item.type === "Movie");
  const seriesLink = links.find((item) => item.type === "Series");
  const libraries = [];
  if (movies.length > 0 && movieLink?.writable) {
    libraries.push(
      await ensureMediaServerVirtualFolder(settings, {
        name: activeConfig.DeletionLibraries.Movies,
        collectionType: "movies",
        folderPath: activeConfig.ToBeDeletedPaths.Movies,
      }),
    );
  }
  if (series.length > 0 && seriesLink?.writable) {
    libraries.push(
      await ensureMediaServerVirtualFolder(settings, {
        name: activeConfig.DeletionLibraries.Series,
        collectionType: "tvshows",
        folderPath: activeConfig.ToBeDeletedPaths.Series,
      }),
    );
  }

  const emptyLibraries = await removeEmptyDeletionLibraries({
    settings,
    countsByType: { Movie: movies.length, Series: series.length },
    links,
  });

  await refreshMediaServerLibrary(settings);

  return {
    enabled: true,
    provider: label,
    message: "Deletion library sync completed.",
    pending: active.length,
    libraries,
    librariesRemoved: emptyLibraries.removed,
    libraryRemovalSkipped: emptyLibraries.skipped,
    links,
    refreshed: true,
  };
}

export async function rebuildPendingFromDeletionQueue({
  settings,
  existingPending = [],
  backupPending = [],
  manifestDirectory = "./data/library-sync",
  now = new Date(),
  timezone = "UTC",
}) {
  const entries = await currentManifestEntries({ settings, manifestDirectory });
  if (entries.length === 0) {
    return {
      found: 0,
      added: 0,
      pending: Array.isArray(existingPending) ? existingPending : [],
      message: "No managed Leaving Soon queue entries were found.",
    };
  }

  const active = activePendingItems(existingPending);
  const activeKeys = new Set(active.map((item) => itemKey(item.Type, item.ItemId)));
  const backupByKey = new Map(
    activePendingItems(backupPending).map((item) => [
      itemKey(item.Type, item.ItemId),
      item,
    ]),
  );
  let mediaServerItemsByKey = new Map();
  if (canManageMediaServerLibraries(settings)) {
    try {
      const mediaServerItems = await getMediaServerItemsByIds(
        settings,
        entries.map((item) => item.itemId),
      );
      mediaServerItemsByKey = new Map(
        mediaServerItems.map((item) => [itemKey(item.Type, item.ItemId), item]),
      );
    } catch {
      mediaServerItemsByKey = new Map();
    }
  }

  const candidates = [];
  for (const { type, itemId, entry } of entries) {
    const key = itemKey(type, itemId);
    if (activeKeys.has(key)) continue;
    const fromMediaServer = mediaServerItemsByKey.get(key);
    const fromBackup = backupByKey.get(key);
    const fallback = metadataFromManagedPath(entry.path, type);
    candidates.push({
      ...(fromBackup || {}),
      ...(fromMediaServer || {}),
      ItemId: itemId,
      Type: type,
      Title: fromMediaServer?.Title || fromBackup?.Title || fallback.title,
      Year: fromMediaServer?.Year || fromBackup?.Year || fallback.year,
      Path: fromMediaServer?.Path || fromBackup?.Path || entry.target || null,
      Reason: fromBackup?.Reason || `Rebuilt from current ${mediaServerLabel(settings)} Leaving Soon queue.`,
      DateSource: fromBackup?.DateSource || "leaving-soon-queue",
      QualifyingDate: fromBackup?.QualifyingDate || null,
      HasPrimaryImage: Boolean(
        fromMediaServer?.HasPrimaryImage || fromBackup?.HasPrimaryImage,
      ),
      Genres: Array.isArray(fromBackup?.Genres) ? fromBackup.Genres : [],
    });
  }

  const records = createPendingRecords(
    candidates,
    formatDateInTimezone(now, timezone),
  );

  return {
    found: entries.length,
    added: records.length,
    pending: [...(Array.isArray(existingPending) ? existingPending : []), ...records],
    message:
      records.length > 0
        ? `Rebuilt ${records.length} pending item(s) from current Leaving Soon queue folders.`
        : "Current Leaving Soon queue items were already present in pending.",
  };
}
