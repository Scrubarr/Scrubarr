import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { createMaintenanceWorkflows } from "../src/app/workflows.js";

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
