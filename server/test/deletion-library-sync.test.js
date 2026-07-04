import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { syncDeletionLibraries } from "../src/services/deletion-library-sync.js";

function settings(overrides = {}) {
  return {
    ...createDefaultSettings({
      dataDirectory: "./data",
      logDirectory: "./logs",
    }),
    ...overrides,
  };
}

test("deletion library sync is a safe no-op when no items are pending", async () => {
  const result = await syncDeletionLibraries({
    settings: settings({
      Emby: {
        ...createDefaultSettings({}).Emby,
        CreateDeletionLibraries: true,
      },
    }),
    pending: [],
  });

  assert.equal(result.enabled, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.message, "No pending items to sync.");
});

test("deletion library sync creates Emby libraries, queue links, and requests a targeted scan", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let virtualFolderQueryCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    calls.push({
      url: String(url),
      pathname: requestUrl.pathname,
      searchParams: requestUrl.searchParams,
      method: options.method || "GET",
      body: options.body,
    });
    if (String(url).includes("/Library/VirtualFolders/Query")) {
      virtualFolderQueryCount += 1;
      return Response.json({
        Items: virtualFolderQueryCount === 1
          ? []
          : [{ Name: "Movies Leaving Soon", ItemId: "movie-library" }],
      });
    }
    if (requestUrl.pathname === "/Items") return Response.json({ TotalRecordCount: 1 });
    if (String(url).endsWith("/Users")) {
      return Response.json([{ Id: "user-1" }]);
    }
    if (String(url).includes("/Users/user-1/Items/movie-1")) {
      return Response.json({
        Id: "movie-1",
        Path: "H:\\Movies\\Example Movie\\Example Movie.mkv",
        MediaSources: [{ Path: "H:\\Movies\\Example Movie\\Example Movie.mkv" }],
      });
    }
    return new Response(null, { status: 204 });
  };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-libraries-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");

  try {
    const config = settings();
    config.Emby.ServerUrl = "http://emby.local:8096";
    config.Emby.ApiKey = "emby-key";
    config.Emby.CreateDeletionLibraries = true;
    config.Emby.ToBeDeletedPaths.Movies = movieDirectory;
    config.Emby.ToBeDeletedPaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [
        {
          ItemId: "movie-1",
          Title: "Example Movie",
          Type: "Movie",
          Year: 2020,
          Path: "H:\\Movies\\Example Movie",
        },
      ],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.refreshed, true);
    assert.equal(result.libraries.length, 1);
    assert.equal(result.libraries[0].created, true);
    assert.equal(result.links[0].linksCreated, 1);
    assert.equal(result.globalScanFallback, false);
    assert.deepEqual(result.scanTargets, [
      {
        type: "Movie",
        name: "Movies Leaving Soon",
        id: "movie-library",
        targeted: true,
      },
    ]);
    assert.deepEqual(result.indexedItems, [
      {
        type: "Movie",
        name: "Movies Leaving Soon",
        id: "movie-library",
        count: 1,
        refreshProgress: null,
      },
    ]);

    const linkPath = path.join(movieDirectory, "Example Movie (2020).strm");
    assert.equal(
      await fs.readFile(linkPath, "utf8"),
      "H:\\Movies\\Example Movie\\Example Movie.mkv\n",
    );

    const manifest = JSON.parse(
      await fs.readFile(path.join(manifestDirectory, "deletion-library-movie.json"), "utf8"),
    );
    assert.equal(manifest["movie-1"].target, "H:\\Movies\\Example Movie\\Example Movie.mkv");
    await assert.rejects(
      fs.access(path.join(movieDirectory, ".scrubarr-links.json")),
      /ENOENT/,
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("/Library/VirtualFolders")));
    assert.ok(calls.some((call) => call.method === "POST" && call.pathname === "/Items/movie-library/Refresh"));
    assert.ok(!calls.some((call) => call.method === "POST" && call.pathname === "/Library/Refresh"));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync separates Emby queue paths from write paths", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).includes("/Library/VirtualFolders/Query")) {
      return Response.json({ Items: [] });
    }
    if (String(url).endsWith("/Users")) {
      return Response.json([{ Id: "user-1" }]);
    }
    if (String(url).includes("/Users/user-1/Items/movie-1")) {
      return Response.json({
        Id: "movie-1",
        Path: "H:\\Movies\\Example Movie\\Example Movie.mkv",
        MediaSources: [{ Path: "H:\\Movies\\Example Movie\\Example Movie.mkv" }],
      });
    }
    return new Response(null, { status: 204 });
  };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-libraries-paths-"));
  const writeDirectory = path.join(directory, "container-movies");
  const manifestDirectory = path.join(directory, "manifest");

  try {
    const config = settings();
    config.Emby.ServerUrl = "http://emby.local:8096";
    config.Emby.ApiKey = "emby-key";
    config.Emby.CreateDeletionLibraries = true;
    config.Emby.ToBeDeletedPaths.Movies = "B:\\Working Directory\\Scrubarr Emby Libraries\\Movies queued";
    config.Emby.QueueWritePaths.Movies = writeDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [
        {
          ItemId: "movie-1",
          Title: "Example Movie",
          Type: "Movie",
          Year: 2020,
          Path: "H:\\Movies\\Example Movie",
        },
      ],
      manifestDirectory,
    });

    assert.equal(result.links[0].queuePath, writeDirectory);
    assert.equal(
      result.links[0].embyPath,
      "B:\\Working Directory\\Scrubarr Emby Libraries\\Movies queued",
    );

    const createLibraryCall = calls.find(
      (call) => call.method === "POST" && call.url.includes("/Library/VirtualFolders"),
    );
    const body = JSON.parse(createLibraryCall.body);
    assert.deepEqual(body.Paths, [
      "B:\\Working Directory\\Scrubarr Emby Libraries\\Movies queued",
    ]);

    const linkPath = path.join(writeDirectory, "Example Movie (2020).strm");
    assert.equal(
      await fs.readFile(linkPath, "utf8"),
      "H:\\Movies\\Example Movie\\Example Movie.mkv\n",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync creates Jellyfin libraries and requests a targeted Jellyfin scan", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let virtualFolderQueryCount = 0;
  let linkExistedBeforeLibraryCreate = false;
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    calls.push({
      url: String(url),
      pathname: requestUrl.pathname,
      searchParams: requestUrl.searchParams,
      method: options.method || "GET",
      body: options.body,
    });
    if (
      requestUrl.pathname === "/Library/VirtualFolders" &&
      (options.method || "GET") === "GET"
    ) {
      virtualFolderQueryCount += 1;
      return Response.json(
        virtualFolderQueryCount === 1
          ? []
          : [{ Name: "Movies Leaving Soon", ItemId: "movie-library" }],
      );
    }
    if (requestUrl.pathname === "/Items") return Response.json({ TotalRecordCount: 1 });
    if (
      requestUrl.pathname === "/Library/VirtualFolders" &&
      (options.method || "GET") === "POST"
    ) {
      linkExistedBeforeLibraryCreate = await fs
        .access(path.join(movieDirectory, "Example Movie (2020).strm"))
        .then(() => true)
        .catch(() => false);
      return new Response(null, { status: 204 });
    }
    if (requestUrl.pathname === "/Users") {
      return Response.json([{ Id: "user-1" }]);
    }
    if (requestUrl.pathname === "/Users/user-1/Items/movie-1") {
      return Response.json({
        Id: "movie-1",
        Path: "/media/movies/Example Movie/Example Movie.mkv",
        MediaSources: [{ Path: "/media/movies/Example Movie/Example Movie.mkv" }],
      });
    }
    return new Response(null, { status: 204 });
  };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-jellyfin-libraries-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");

  try {
    const config = settings();
    config.MediaServer.Provider = "jellyfin";
    config.MediaServer.Locked = true;
    config.Jellyfin.ServerUrl = "http://jellyfin.local:8096";
    config.Jellyfin.ApiKey = "jellyfin-key";
    config.Jellyfin.CreateDeletionLibraries = true;
    config.Jellyfin.ToBeDeletedPaths.Movies = "/queue/movies";
    config.Jellyfin.ToBeDeletedPaths.Series = "/queue/series";
    config.Jellyfin.QueueWritePaths.Movies = movieDirectory;
    config.Jellyfin.QueueWritePaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [
        {
          ItemId: "movie-1",
          Title: "Example Movie",
          Type: "Movie",
          Year: 2020,
          Path: "/media/movies/Example Movie",
        },
      ],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.provider, "Jellyfin");
    assert.equal(result.refreshed, true);
    assert.equal(result.links[0].linksCreated, 1);
    assert.equal(linkExistedBeforeLibraryCreate, true);
    assert.equal(result.globalScanFallback, false);
    assert.deepEqual(result.scanTargets, [
      {
        type: "Movie",
        name: "Movies Leaving Soon",
        id: "movie-library",
        targeted: true,
      },
    ]);
    assert.deepEqual(result.indexedItems, [
      {
        type: "Movie",
        name: "Movies Leaving Soon",
        id: "movie-library",
        count: 1,
        refreshProgress: null,
      },
    ]);

    const createLibraryCall = calls.find(
      (call) =>
        call.method === "POST" &&
        call.pathname === "/Library/VirtualFolders",
    );
    assert.ok(createLibraryCall);
    assert.equal(createLibraryCall.searchParams.get("name"), "Movies Leaving Soon");
    assert.equal(createLibraryCall.searchParams.get("collectionType"), "movies");
    assert.equal(createLibraryCall.searchParams.get("paths"), "/queue/movies");
    assert.equal(createLibraryCall.searchParams.get("refreshLibrary"), "true");

    const linkPath = path.join(movieDirectory, "Example Movie (2020).strm");
    assert.equal(
      await fs.readFile(linkPath, "utf8"),
      "/media/movies/Example Movie/Example Movie.mkv\n",
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.pathname === "/Items/movie-library/Refresh"));
    assert.ok(!calls.some((call) => call.method === "POST" && call.pathname === "/Library/Refresh"));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync ignores items marked with a deleted date", async () => {
  const result = await syncDeletionLibraries({
    settings: settings({
      Emby: {
        ...createDefaultSettings({}).Emby,
        CreateDeletionLibraries: true,
      },
    }),
    pending: [
      {
        ItemId: "movie-1",
        Title: "Deleted Movie",
        Type: "Movie",
        Deleted: "2026-06-20",
      },
    ],
  });

  assert.equal(result.enabled, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.message, "No pending items to sync.");
});

test("deletion library sync removes empty Jellyfin libraries by name", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    calls.push({
      url: String(url),
      pathname: requestUrl.pathname,
      searchParams: requestUrl.searchParams,
      method: options.method || "GET",
      body: options.body,
    });
    if (
      requestUrl.pathname === "/Library/VirtualFolders" &&
      (options.method || "GET") === "GET"
    ) {
      return Response.json([
        { Name: "Movies Leaving Soon" },
        { Name: "Shows Leaving Soon" },
      ]);
    }
    return new Response(null, { status: 204 });
  };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-jellyfin-prune-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");
  const movieLink = path.join(movieDirectory, "Deleted Movie.strm");

  try {
    await fs.mkdir(movieDirectory, { recursive: true });
    await fs.mkdir(seriesDirectory, { recursive: true });
    await fs.mkdir(manifestDirectory, { recursive: true });
    await fs.writeFile(movieLink, "/media/movies/deleted.mkv\n", "utf8");
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify({ "movie-1": { path: movieLink, mode: "strm" } }, null, 2)}\n`,
      "utf8",
    );

    const config = settings();
    config.MediaServer.Provider = "jellyfin";
    config.MediaServer.Locked = true;
    config.Jellyfin.ServerUrl = "http://jellyfin.local:8096";
    config.Jellyfin.ApiKey = "jellyfin-key";
    config.Jellyfin.CreateDeletionLibraries = true;
    config.Jellyfin.QueueWritePaths.Movies = movieDirectory;
    config.Jellyfin.QueueWritePaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.provider, "Jellyfin");
    assert.equal(result.refreshed, true);
    assert.deepEqual(
      result.librariesRemoved.map((library) => library.name),
      ["Movies Leaving Soon", "Shows Leaving Soon"],
    );
    await assert.rejects(fs.access(movieLink), /ENOENT/);

    const deleteCalls = calls.filter(
      (call) =>
        call.method === "DELETE" &&
        call.pathname === "/Library/VirtualFolders",
    );
    assert.deepEqual(
      deleteCalls.map((call) => call.searchParams.get("name")),
      ["Movies Leaving Soon", "Shows Leaving Soon"],
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.pathname === "/Library/Refresh"));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync prunes managed links when pending becomes empty", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body });
    if (String(url).includes("/Library/VirtualFolders/Query")) {
      return Response.json({
        Items: [
          { Name: "Movies Leaving Soon", ItemId: "movie-library" },
          { Name: "Shows Leaving Soon", ItemId: "series-library" },
        ],
      });
    }
    return new Response(null, { status: 204 });
  };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-libraries-prune-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");
  const movieLink = path.join(movieDirectory, "Deleted Movie.strm");
  const seriesLink = path.join(seriesDirectory, "Deleted Series");

  try {
    await fs.mkdir(movieDirectory, { recursive: true });
    await fs.mkdir(seriesLink, { recursive: true });
    await fs.mkdir(path.join(seriesDirectory, "backdrops"), { recursive: true });
    await fs.mkdir(manifestDirectory, { recursive: true });
    await fs.writeFile(movieLink, "H:\\Movies\\Deleted Movie\\movie.mkv\n", "utf8");
    await fs.writeFile(path.join(seriesLink, "S01E01 - Pilot.strm"), "N:\\Shows\\Deleted Series\\Pilot.mkv\n", "utf8");
    await fs.writeFile(path.join(seriesDirectory, "theme.mp3"), "theme", "utf8");
    await fs.writeFile(path.join(seriesDirectory, "backdrops", "theme.mp4"), "theme", "utf8");
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify({ "movie-1": { path: movieLink, mode: "strm" } }, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-series.json"),
      `${JSON.stringify({ "series-1": { path: seriesLink, mode: "strm-series" } }, null, 2)}\n`,
      "utf8",
    );

    const config = settings();
    config.Emby.ServerUrl = "http://emby.local:8096";
    config.Emby.ApiKey = "emby-key";
    config.Emby.CreateDeletionLibraries = true;
    config.Emby.ToBeDeletedPaths.Movies = movieDirectory;
    config.Emby.ToBeDeletedPaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.pending, 0);
    assert.equal(result.refreshed, true);
    assert.equal(result.links[0].linksRemoved, 1);
    assert.equal(result.links[1].linksRemoved, 1);
    assert.deepEqual(
      result.librariesRemoved.map((library) => library.name),
      ["Movies Leaving Soon", "Shows Leaving Soon"],
    );
    await assert.rejects(fs.access(movieLink), /ENOENT/);
    await assert.rejects(fs.access(seriesLink), /ENOENT/);
    await assert.rejects(fs.access(path.join(seriesDirectory, "theme.mp3")), /ENOENT/);
    await assert.rejects(fs.access(path.join(seriesDirectory, "backdrops")), /ENOENT/);
    const deleteCalls = calls.filter(
      (call) => call.method === "POST" && call.url.includes("/Library/VirtualFolders/Delete"),
    );
    assert.equal(deleteCalls.length, 2);
    assert.deepEqual(
      deleteCalls.map((call) => JSON.parse(call.body).Id),
      ["movie-library", "series-library"],
    );
    assert.ok(calls.some((call) => call.method === "POST" && call.url.includes("/Library/Refresh")));
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync refuses manifest paths outside the queue path", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-libraries-guard-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");
  const outsideDirectory = path.join(directory, "outside");
  const outsideFile = path.join(outsideDirectory, "do-not-remove.strm");

  try {
    await fs.mkdir(movieDirectory, { recursive: true });
    await fs.mkdir(seriesDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.mkdir(manifestDirectory, { recursive: true });
    await fs.writeFile(outsideFile, "outside", "utf8");
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify({ "movie-1": { path: outsideFile, mode: "strm" } }, null, 2)}\n`,
      "utf8",
    );

    const config = settings();
    config.Emby.CreateDeletionLibraries = true;
    config.Emby.ToBeDeletedPaths.Movies = movieDirectory;
    config.Emby.ToBeDeletedPaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.links[0].linksRemoved, 0);
    assert.match(result.links[0].skipped[0].reason, /outside the queue path/);
    assert.equal(await fs.readFile(outsideFile, "utf8"), "outside");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("deletion library sync refuses managed paths that resolve outside the queue path", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-libraries-realpath-"));
  const movieDirectory = path.join(directory, "movies");
  const seriesDirectory = path.join(directory, "series");
  const manifestDirectory = path.join(directory, "manifest");
  const outsideDirectory = path.join(directory, "outside");
  const outsideFile = path.join(outsideDirectory, "do-not-remove.strm");
  const symlinkPath = path.join(movieDirectory, "Looks Safe.strm");

  try {
    await fs.mkdir(movieDirectory, { recursive: true });
    await fs.mkdir(seriesDirectory, { recursive: true });
    await fs.mkdir(outsideDirectory, { recursive: true });
    await fs.mkdir(manifestDirectory, { recursive: true });
    await fs.writeFile(outsideFile, "outside", "utf8");
    try {
      await fs.symlink(outsideFile, symlinkPath, "file");
    } catch (error) {
      t.skip(`Symlink creation is not available here: ${error.message}`);
      return;
    }
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify({ "movie-1": { path: symlinkPath, mode: "strm" } }, null, 2)}\n`,
      "utf8",
    );

    const config = settings();
    config.Emby.CreateDeletionLibraries = true;
    config.Emby.ToBeDeletedPaths.Movies = movieDirectory;
    config.Emby.ToBeDeletedPaths.Series = seriesDirectory;

    const result = await syncDeletionLibraries({
      settings: config,
      pending: [],
      manifestDirectory,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.links[0].linksRemoved, 0);
    assert.match(result.links[0].skipped[0].reason, /does not resolve inside/);
    assert.equal(await fs.readFile(outsideFile, "utf8"), "outside");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
