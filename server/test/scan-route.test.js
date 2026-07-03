import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDefaultSettings } from "../src/config/settings.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("preview route collects remote data without changing the queue", async () => {
  const fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(
        JSON.stringify([
          { Name: "Movies", ItemId: "library-1", CollectionType: "movies" },
        ]),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items?")) {
      response.end(
        JSON.stringify({
          Items: [
            {
              Id: "emby-1",
              Name: "Fixture Movie",
              Type: "Movie",
              ProductionYear: 2020,
              Path: "/media/fixture",
              DateCreated: "2020-01-01T00:00:00.000Z",
              ProviderIds: { Tmdb: "99" },
              UserData: { PlayCount: 0 },
              Genres: ["Comedy", "Adventure"],
            },
          ],
        }),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items/Resume?")) {
      response.end(JSON.stringify({ Items: [] }));
      return;
    }

    if (request.url?.startsWith("/Items?")) {
      response.end(
        JSON.stringify({
          Items: [
            { Id: "emby-1", Name: "Fixture Movie", Type: "Movie", Genres: ["Comedy"] },
            { Id: "emby-2", Name: "Another Movie", Type: "Movie", Genres: ["Drama"] },
            { Id: "emby-3", Name: "No Genre", Type: "Movie", Genres: [] },
          ],
        }),
      );
      return;
    }

    if (request.url === "/api/v3/movie") {
      response.end(
        JSON.stringify([
          {
            id: 7,
            tmdbId: 99,
            path: "/media/fixture",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-scan-"));
  const pendingFile = path.join(directory, "ToDelete.json");
  const configFile = path.join(directory, "config.json");
  const exclusionsFile = path.join(directory, "Exclusions.json");
  const runLogFile = path.join(directory, "RunLog.json");
  const originalQueue = '[{"ItemId":"keep-me","Title":"Existing","Type":"Series"}]\n';
  await Promise.all([
    fs.writeFile(pendingFile, originalQueue, "utf8"),
    fs.writeFile(exclusionsFile, "[]\n", "utf8"),
  ]);

  const runtime = {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile,
    pendingFile,
    exclusionsFile,
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile,
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
  const settings = createDefaultSettings(runtime);
  settings.Emby.ServerUrl = `http://127.0.0.1:${fixturePort}`;
  settings.Emby.ApiKey = "emby-key";
  settings.Emby.UserIds = ["user-1"];
  settings.Emby.SearchLibraries = ["Movies"];
  settings.Mode.Type = "all";
  settings.Arrs.Radarr.Enabled = true;
  settings.Arrs.Radarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Radarr.ApiKey = "radarr-key";
  settings.Limits.MaxMoviesMarked = 5;
  await fs.writeFile(configFile, JSON.stringify(settings), "utf8");

  const appServer = http.createServer(createApp(runtime));
  const appPort = await listen(appServer);

  try {
    const genreResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/settings/emby/genres`,
    );
    const genres = await genreResponse.json();

    assert.equal(genreResponse.status, 200);
    assert.deepEqual(genres.genres, ["Comedy", "Drama"]);

    const response = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/preview`,
      { method: "POST" },
    );
    const result = await response.json();

    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.readOnly, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].Title, "Fixture Movie");
    assert.equal(result.candidates[0].Arr, "Radarr");
    assert.equal(result.candidates[0].DateSource, "arr");
    assert.equal(await fs.readFile(pendingFile, "utf8"), originalQueue);
    const runLog = JSON.parse(await fs.readFile(runLogFile, "utf8"));
    assert.equal(runLog.length, 1);
    assert.equal(runLog[0].source, "manual");
    assert.equal(runLog[0].status, "success");
    assert.equal(runLog[0].candidates, 1);

    const commitResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ["emby-1"] }),
      },
    );
    const commit = await commitResponse.json();
    const queueAfterCommit = JSON.parse(await fs.readFile(pendingFile, "utf8"));

    assert.equal(commitResponse.status, 200);
    assert.equal(commit.added.length, 1);
    assert.equal(queueAfterCommit.length, 2);
    assert.equal(queueAfterCommit[1].ItemId, "emby-1");
    assert.deepEqual(queueAfterCommit[1].Notified, []);
    assert.equal(queueAfterCommit[1].Deleted, null);

    const duplicateResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ["emby-1"] }),
      },
    );
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.added.length, 0);
    assert.deepEqual(duplicate.skippedItemIds, ["emby-1"]);
    assert.equal(
      JSON.parse(await fs.readFile(pendingFile, "utf8")).length,
      2,
    );
  } finally {
    await close(appServer);
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("preview route collects Jellyfin data and commits pending records", async () => {
  const fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(
        JSON.stringify([
          { Name: "Jelly Movies", ItemId: "jelly-library-1", CollectionType: "movies" },
        ]),
      );
      return;
    }

    if (request.url === "/Users") {
      response.end(JSON.stringify([{ Id: "jelly-user-1", Name: "Jelly Admin" }]));
      return;
    }

    if (request.url?.startsWith("/Users/jelly-user-1/Items?")) {
      response.end(
        JSON.stringify({
          Items: [
            {
              Id: "jelly-movie-1",
              Name: "Jellyfin Fixture Movie",
              Type: "Movie",
              ProductionYear: 2019,
              Path: "/jellyfin/media/fixture",
              DateCreated: "2020-01-01T00:00:00.000Z",
              ProviderIds: { Tmdb: "199" },
              ImageTags: { Primary: "poster-tag" },
              UserData: { PlayCount: 0 },
              Genres: ["Comedy", "Sci-Fi"],
            },
          ],
        }),
      );
      return;
    }

    if (request.url?.startsWith("/Users/jelly-user-1/Items/Resume?")) {
      response.end(JSON.stringify({ Items: [] }));
      return;
    }

    if (request.url === "/api/v3/movie") {
      response.end(
        JSON.stringify([
          {
            id: 19,
            tmdbId: 199,
            path: "/jellyfin/media/fixture",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-jellyfin-scan-"));
  const runtime = {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
  await Promise.all([
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
  ]);

  const settings = createDefaultSettings(runtime);
  settings.MediaServer = { Provider: "jellyfin", Locked: true };
  settings.Jellyfin.ServerUrl = `http://127.0.0.1:${fixturePort}`;
  settings.Jellyfin.ApiKey = "jellyfin-key";
  settings.Jellyfin.UserIds = [];
  settings.Jellyfin.SearchLibraries = ["Jelly Movies"];
  settings.Mode.Type = "all";
  settings.Arrs.Radarr.Enabled = true;
  settings.Arrs.Radarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Radarr.ApiKey = "radarr-key";
  settings.Limits.MaxMoviesMarked = 5;
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const appServer = http.createServer(createApp(runtime));
  const appPort = await listen(appServer);

  try {
    const response = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/preview`,
      { method: "POST" },
    );
    const result = await response.json();

    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].ItemId, "jelly-movie-1");
    assert.equal(result.candidates[0].Title, "Jellyfin Fixture Movie");
    assert.equal(result.candidates[0].Type, "Movie");
    assert.equal(result.candidates[0].Year, 2019);
    assert.equal(result.candidates[0].Arr, "Radarr");
    assert.equal(result.candidates[0].ArrId, 19);
    assert.equal(result.candidates[0].HasPrimaryImage, true);

    const commitResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/commit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ["jelly-movie-1"] }),
      },
    );
    const commit = await commitResponse.json();
    const queueAfterCommit = JSON.parse(await fs.readFile(runtime.pendingFile, "utf8"));

    assert.equal(commitResponse.status, 200, JSON.stringify(commit));
    assert.equal(commit.added.length, 1);
    assert.equal(queueAfterCommit.length, 1);
    assert.equal(queueAfterCommit[0].ItemId, "jelly-movie-1");
    assert.equal(queueAfterCommit[0].Title, "Jellyfin Fixture Movie");
    assert.equal(queueAfterCommit[0].Arr, "Radarr");
    assert.equal(queueAfterCommit[0].ArrId, 19);
    assert.equal(queueAfterCommit[0].HasPrimaryImage, true);
  } finally {
    await close(appServer);
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("preview route skips media currently in Emby resume", async () => {
  const fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(
        JSON.stringify([
          { Name: "Movies", ItemId: "library-1", CollectionType: "movies" },
          { Name: "TV shows", ItemId: "library-2", CollectionType: "tvshows" },
        ]),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items/Resume?")) {
      response.end(
        JSON.stringify({
          Items: [
            { Id: "movie-1", Name: "Resume Movie", Type: "Movie" },
            {
              Id: "episode-1",
              Name: "Resume Episode",
              Type: "Episode",
              SeriesId: "series-1",
            },
          ],
        }),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items?")) {
      const url = new URL(`http://fixture${request.url}`);
      const type = url.searchParams.get("IncludeItemTypes");
      response.end(
        JSON.stringify({
          Items:
            type === "Movie"
              ? [
                  {
                    Id: "movie-1",
                    Name: "Resume Movie",
                    Type: "Movie",
                    ProductionYear: 2020,
                    Path: "/media/resume-movie",
                    DateCreated: "2020-01-01T00:00:00.000Z",
                    ProviderIds: { Tmdb: "100" },
                    UserData: { PlayCount: 0 },
                  },
                ]
              : [
                  {
                    Id: "series-1",
                    Name: "Resume Series",
                    Type: "Series",
                    ProductionYear: 2020,
                    Path: "/media/resume-series",
                    DateCreated: "2020-01-01T00:00:00.000Z",
                    ProviderIds: { Tvdb: "200" },
                    UserData: { PlayCount: 0 },
                  },
                ],
        }),
      );
      return;
    }

    if (request.url === "/api/v3/movie") {
      response.end(
        JSON.stringify([
          {
            id: 10,
            tmdbId: 100,
            path: "/media/resume-movie",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    if (request.url === "/api/v3/series") {
      response.end(
        JSON.stringify([
          {
            id: 20,
            tvdbId: 200,
            path: "/media/resume-series",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-resume-"));
  const runtime = {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
  await Promise.all([
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
  ]);

  const settings = createDefaultSettings(runtime);
  settings.Emby.ServerUrl = `http://127.0.0.1:${fixturePort}`;
  settings.Emby.ApiKey = "emby-key";
  settings.Emby.UserIds = ["user-1"];
  settings.Emby.SearchLibraries = ["Movies", "TV shows"];
  settings.Mode.Type = "all";
  settings.Arrs.Radarr.Enabled = true;
  settings.Arrs.Radarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Radarr.ApiKey = "radarr-key";
  settings.Arrs.Sonarr.Enabled = true;
  settings.Arrs.Sonarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Sonarr.ApiKey = "sonarr-key";
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const appServer = http.createServer(createApp(runtime));
  const appPort = await listen(appServer);

  try {
    const response = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/preview`,
      { method: "POST" },
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.skipped["in-progress"], 2);
    const tracked = JSON.parse(await fs.readFile(runtime.inProgressFile, "utf8"));
    assert.deepEqual(
      tracked.map((item) => item.ItemId).sort(),
      ["movie-1", "series-1"],
    );
  } finally {
    await close(appServer);
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("preview route loads episode activity for whole-series cleanup", async () => {
  let episodeActivityRequests = 0;
  const fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(
        JSON.stringify([
          { Name: "TV shows", ItemId: "library-2", CollectionType: "tvshows" },
        ]),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items/Resume?")) {
      response.end(JSON.stringify({ Items: [] }));
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items?")) {
      const url = new URL(`http://fixture${request.url}`);
      const type = url.searchParams.get("IncludeItemTypes");
      if (type === "Episode") {
        episodeActivityRequests += 1;
        response.end(
          JSON.stringify({
            Items: [
              {
                Id: "episode-1",
                Name: "Pilot",
                Type: "Episode",
                SeriesId: "series-1",
                UserData: { PlayCount: 0 },
              },
              {
                Id: "episode-2",
                Name: "Watched Episode",
                Type: "Episode",
                SeriesId: "series-1",
                UserData: {
                  PlayCount: 1,
                  LastPlayedDate: "2025-01-01T00:00:00.000Z",
                },
              },
            ],
          }),
        );
        return;
      }

      response.end(
        JSON.stringify({
          Items: [
            {
              Id: "series-1",
              Name: "Episode Fixture",
              Type: "Series",
              ProductionYear: 2020,
              Path: "/media/episode-fixture",
              DateCreated: "2020-01-01T00:00:00.000Z",
              ProviderIds: { Tvdb: "200" },
              UserData: { PlayCount: 0, LastPlayedDate: null },
            },
          ],
        }),
      );
      return;
    }

    if (request.url === "/api/v3/series") {
      response.end(
        JSON.stringify([
          {
            id: 20,
            tvdbId: 200,
            path: "/media/episode-fixture",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-episodes-"));
  const runtime = {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
  await Promise.all([
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
  ]);

  const settings = createDefaultSettings(runtime);
  settings.Emby.ServerUrl = `http://127.0.0.1:${fixturePort}`;
  settings.Emby.ApiKey = "emby-key";
  settings.Emby.UserIds = ["user-1"];
  settings.Emby.SearchLibraries = ["TV shows"];
  settings.Mode.Type = "watched";
  settings.Mode.WatchedDays = 90;
  settings.Mode.DaysOlderThan = 0;
  settings.Arrs.Sonarr.Enabled = true;
  settings.Arrs.Sonarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Sonarr.ApiKey = "sonarr-key";
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const appServer = http.createServer(createApp(runtime));
  const appPort = await listen(appServer);

  try {
    const response = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/preview`,
      { method: "POST" },
    );
    const result = await response.json();

    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(episodeActivityRequests, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].Title, "Episode Fixture");
    assert.equal(result.candidates[0].DateSource, "emby-episode-last-played");
    assert.match(result.candidates[0].Reason, /Latest episode watched/);
  } finally {
    await close(appServer);
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("cleanup decision route explains eligible and unknown-watch-history titles", async () => {
  const fixtureServer = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(
        JSON.stringify([
          { Name: "Movies", ItemId: "library-1", CollectionType: "movies" },
        ]),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items?")) {
      response.end(
        JSON.stringify({
          Items: [
            {
              Id: "eligible-movie",
              Name: "Eligible Movie",
              Type: "Movie",
              ProductionYear: 2019,
              Path: "/media/eligible-movie",
              DateCreated: "2020-01-01T00:00:00.000Z",
              ProviderIds: { Tmdb: "300" },
              UserData: { PlayCount: 0 },
            },
            {
              Id: "unknown-movie",
              Name: "Unknown History Movie",
              Type: "Movie",
              ProductionYear: 2018,
              Path: "/media/unknown-movie",
              DateCreated: "2020-01-01T00:00:00.000Z",
              ProviderIds: { Tmdb: "301" },
            },
          ],
        }),
      );
      return;
    }

    if (request.url?.startsWith("/Users/user-1/Items/Resume?")) {
      response.end(JSON.stringify({ Items: [] }));
      return;
    }

    if (request.url === "/api/v3/movie") {
      response.end(
        JSON.stringify([
          {
            id: 300,
            tmdbId: 300,
            path: "/media/eligible-movie",
            added: "2020-01-02T00:00:00.000Z",
          },
          {
            id: 301,
            tmdbId: 301,
            path: "/media/unknown-movie",
            added: "2020-01-02T00:00:00.000Z",
          },
        ]),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-decision-"));
  const runtime = {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    appLogFile: path.join(directory, "logs", "App.log"),
    inProgressFile: path.join(directory, "InProgress.json"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
  await Promise.all([
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
  ]);

  const settings = createDefaultSettings(runtime);
  settings.Emby.ServerUrl = `http://127.0.0.1:${fixturePort}`;
  settings.Emby.ApiKey = "emby-key";
  settings.Emby.UserIds = ["user-1"];
  settings.Emby.SearchLibraries = ["Movies"];
  settings.Mode.Type = "all";
  settings.Mode.DaysOlderThan = 0;
  settings.Arrs.Radarr.Enabled = true;
  settings.Arrs.Radarr.Url = `http://127.0.0.1:${fixturePort}`;
  settings.Arrs.Radarr.ApiKey = "radarr-key";
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const appServer = http.createServer(createApp(runtime));
  const appPort = await listen(appServer);

  try {
    const eligibleResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/decision/eligible-movie`,
    );
    const eligible = await eligibleResponse.json();

    assert.equal(eligibleResponse.status, 200, JSON.stringify(eligible));
    assert.equal(eligible.eligible, true);
    assert.equal(eligible.item.Title, "Eligible Movie");
    assert.equal(eligible.candidate.Title, "Eligible Movie");
    assert.match(eligible.reason, /Unwatched and added/);

    const unknownResponse = await fetch(
      `http://127.0.0.1:${appPort}/api/scans/decision/unknown-movie`,
    );
    const unknown = await unknownResponse.json();

    assert.equal(unknownResponse.status, 200, JSON.stringify(unknown));
    assert.equal(unknown.eligible, false);
    assert.equal(unknown.skip, "watch-history-unknown");
    assert.match(unknown.reason, /could not confirm watch history/);
    assert.equal(unknown.candidate, null);
  } finally {
    await close(appServer);
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
