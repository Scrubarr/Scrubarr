import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { createMaintenanceWorkflows } from "../src/app/workflows.js";

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

function memoryStore(initialValue) {
  let value = structuredClone(initialValue);
  return {
    read: async () => structuredClone(value),
    write: async (next) => {
      value = structuredClone(next);
    },
  };
}

test("coalesces overlapping library sync requests and runs one follow-up sync", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-workflows-"));
  let folderRequests = 0;
  let releaseFirstRequest;
  const firstRequestStarted = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });
  let signalFirstRequest;
  const firstRequestSeen = new Promise((resolve) => {
    signalFirstRequest = resolve;
  });

  globalThis.fetch = async (url) => {
    if (new URL(String(url)).pathname === "/Library/VirtualFolders/Query") {
      folderRequests += 1;
      if (folderRequests === 1) {
        signalFirstRequest();
        await firstRequestStarted;
      }
      return Response.json({ Items: [] });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const settings = createDefaultSettings({
      movieQueueWritePath: path.join(directory, "movies"),
      seriesQueueWritePath: path.join(directory, "series"),
    });
    settings.MediaServer.Locked = true;
    settings.Emby.ServerUrl = "http://emby.local:8096";
    settings.Emby.ApiKey = "test-key";
    settings.Emby.CreateDeletionLibraries = true;
    settings.Emby.ToBeDeletedPaths.Movies = path.join(directory, "movies");
    settings.Emby.ToBeDeletedPaths.Series = path.join(directory, "series");

    const workflows = createMaintenanceWorkflows({
      runtime: {
        timezone: "UTC",
        librarySyncManifestDirectory: path.join(directory, "manifest"),
      },
      stores: {
        settingsStore: { read: async () => settings },
        pendingStore: { read: async () => [] },
      },
      defaults: settings,
      runLog: { append: async () => {} },
      deletionStats: { recordDeletionRun: async () => {} },
      appLog: { info: async () => {}, warn: async () => {} },
      pendingMutations: { run: async (_name, operation) => operation() },
    });

    const first = workflows.syncCurrentDeletionLibraries({ source: "first" });
    await firstRequestSeen;
    const second = workflows.syncCurrentDeletionLibraries({ source: "second" });
    releaseFirstRequest();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(folderRequests, 2);
    assert.equal(firstResult.message, "No pending items to sync.");
    assert.deepEqual(secondResult, firstResult);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("scheduled cleanup removes newly disqualified media and clears its Arr tag", async () => {
  const arrUpdates = [];
  let deleteRequests = 0;
  const fixtureServer = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");

    if (request.url === "/Library/VirtualFolders") {
      response.end(JSON.stringify([
        { Name: "Movies", ItemId: "library-1", CollectionType: "movies" },
      ]));
      return;
    }
    if (request.url?.startsWith("/Users/user-1/Items/Resume?")) {
      response.end(JSON.stringify({ Items: [] }));
      return;
    }
    if (request.url?.startsWith("/Users/user-1/Items?")) {
      response.end(JSON.stringify({
        Items: [{
          Id: "emby-1",
          Name: "Recently Watched Movie",
          Type: "Movie",
          ProductionYear: 2020,
          Path: "/media/recently-watched",
          DateCreated: "2020-01-01T00:00:00.000Z",
          ProviderIds: { Tmdb: "99" },
          UserData: {
            PlayCount: 1,
            LastPlayedDate: new Date().toISOString(),
          },
          Genres: ["Drama"],
        }],
      }));
      return;
    }
    if (request.url === "/api/v3/movie") {
      response.end(JSON.stringify([{
        id: 7,
        tmdbId: 99,
        path: "/media/recently-watched",
        added: "2020-01-02T00:00:00.000Z",
      }]));
      return;
    }
    if (request.url === "/api/v3/tag") {
      response.end(JSON.stringify([{ id: 12, label: "scrubarr-pending" }]));
      return;
    }
    if (request.url === "/api/v3/movie/7") {
      response.end(JSON.stringify({ id: 7, tags: [12] }));
      return;
    }
    if (request.url === "/api/v3/movie/editor" && request.method === "PUT") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      arrUpdates.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.end(JSON.stringify({ accepted: true }));
      return;
    }
    if (request.method === "DELETE") {
      deleteRequests += 1;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const fixturePort = await listen(fixtureServer);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-cleanup-workflow-"));

  try {
    const settings = createDefaultSettings({
      dataDirectory: directory,
      movieQueueWritePath: path.join(directory, "movies"),
      seriesQueueWritePath: path.join(directory, "series"),
    });
    settings.MediaServer.Locked = true;
    settings.Emby.ServerUrl = `http://127.0.0.1:${fixturePort}`;
    settings.Emby.ApiKey = "emby-key";
    settings.Emby.UserIds = ["user-1"];
    settings.Emby.SearchLibraries = ["Movies"];
    settings.Arrs.Radarr.Enabled = true;
    settings.Arrs.Radarr.Url = `http://127.0.0.1:${fixturePort}`;
    settings.Arrs.Radarr.ApiKey = "radarr-key";
    settings.Arrs.PendingTag.Enabled = true;
    settings.CleanupRules.DryRun = false;
    settings.DeletionSchedule.DaysUntilDeletion = 1;

    const pending = [{
      ItemId: "emby-1",
      Title: "Recently Watched Movie",
      Type: "Movie",
      Year: 2020,
      MarkedDate: "2020-01-01",
      Arr: "Radarr",
      ArrId: 7,
      ProviderIds: { Tmdb: "99" },
      Path: "/media/recently-watched",
    }];
    const pendingStore = memoryStore(pending);
    const runEntries = [];
    const workflows = createMaintenanceWorkflows({
      runtime: {
        timezone: "UTC",
        librarySyncManifestDirectory: path.join(directory, "manifest"),
      },
      stores: {
        settingsStore: memoryStore(settings),
        pendingStore,
        exclusionsStore: memoryStore([]),
        inProgressStore: memoryStore([]),
      },
      defaults: settings,
      runLog: { append: async (entry) => runEntries.push(entry) },
      deletionStats: { recordDeletionRun: async () => {} },
      appLog: { info: async () => {}, warn: async () => {} },
      pendingMutations: { run: async (_name, operation) => operation() },
    });

    const result = await workflows.runScheduledCleanup();

    assert.equal(result.deletedTotal, 0);
    assert.equal(result.removedTotal, 1);
    assert.equal(result.deferredTotal, 0);
    assert.equal(result.untagging.updated, 1);
    assert.equal(result.librarySync.enabled, false);
    assert.deepEqual(await pendingStore.read(), []);
    assert.equal(runEntries.length, 1);
    assert.equal(runEntries[0].removedTotal, 1);
    assert.equal(deleteRequests, 0);
    assert.deepEqual(arrUpdates, [{
      movieIds: [7],
      tags: [12],
      applyTags: "remove",
    }]);
  } finally {
    await close(fixtureServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
