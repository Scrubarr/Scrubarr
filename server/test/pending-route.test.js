import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createDefaultSettings } from "../src/config/settings.js";
import { createPendingRouter } from "../src/routes/pending.js";
import { PendingMutationCoordinator } from "../src/services/pending-mutation-coordinator.js";

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

function createTestApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/pending",
    createPendingRouter({
      pendingStore: {
        read: async () => [],
        write: async () => {},
      },
      exclusionsStore: {
        read: async () => [],
        write: async () => {},
      },
      settingsStore: {
        read: async () => ({}),
      },
      defaults: {},
      timezone: "UTC",
      ...overrides,
    }),
  );
  return app;
}

test("pending route rejects changes while another queue operation is active", async () => {
  const coordinator = new PendingMutationCoordinator();
  let releaseOperation;
  const activeOperation = coordinator.run(
    "scheduled-cleanup",
    () =>
      new Promise((resolve) => {
        releaseOperation = resolve;
      }),
  );

  const server = http.createServer(
    createTestApp({
      pendingMutations: coordinator,
      pendingStore: {
        read: async () => {
          throw new Error("pending store should not be read while busy");
        },
        write: async () => {},
      },
    }),
  );
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/pending/item-1`, {
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error, "pending_queue_busy");
  } finally {
    releaseOperation();
    await activeOperation;
    await close(server);
  }
});

test("pending route removes an item and runs library sync", async () => {
  let writtenPending = null;
  let synced = false;
  const server = http.createServer(
    createTestApp({
      pendingMutations: new PendingMutationCoordinator(),
      pendingStore: {
        read: async () => [
          { ItemId: "remove-me", Title: "Remove Me", Type: "Movie" },
          { ItemId: "keep-me", Title: "Keep Me", Type: "Series" },
        ],
        write: async (records) => {
          writtenPending = records;
        },
      },
      onPendingChanged: async () => {
        synced = true;
        return { enabled: true };
      },
    }),
  );
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/pending/remove-me`,
      { method: "DELETE" },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.removed.ItemId, "remove-me");
    assert.deepEqual(
      writtenPending.map((item) => item.ItemId),
      ["keep-me"],
    );
    assert.equal(synced, true);
  } finally {
    await close(server);
  }
});

test("pending route removes only active stale items after a fresh integrity check", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-pending-route-"));
  const movieQueue = path.join(directory, "queue", "movies");
  const sourceDirectory = path.join(directory, "sources");
  const manifestDirectory = path.join(directory, "manifest");
  const linkPath = path.join(movieQueue, "Keep Movie.strm");
  const sourcePath = path.join(sourceDirectory, "keep.mkv");
  let pending = [
    { ItemId: "keep", Title: "Keep Movie", Type: "Movie" },
    { ItemId: "stale", Title: "Stale Movie", Type: "Movie" },
    {
      ItemId: "deleted-history",
      Title: "Deleted History",
      Type: "Movie",
      DeletedDate: "2026-06-28T00:00:00.000Z",
    },
  ];
  let synced = false;

  try {
    await fs.mkdir(movieQueue, { recursive: true });
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.mkdir(manifestDirectory, { recursive: true });
    await fs.writeFile(linkPath, `${sourcePath}\n`, "utf8");
    await fs.writeFile(sourcePath, "media", "utf8");
    await fs.writeFile(
      path.join(manifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify(
        { keep: { path: linkPath, target: sourcePath, mode: "strm" } },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const defaults = createDefaultSettings({
      dataDirectory: "./data",
      logDirectory: "./logs",
    });
    defaults.Emby.CreateDeletionLibraries = true;
    defaults.Emby.ToBeDeletedPaths.Movies = movieQueue;
    defaults.Emby.QueueWritePaths.Movies = "";

    const server = http.createServer(
      createTestApp({
        pendingMutations: new PendingMutationCoordinator(),
        pendingStore: {
          read: async () => pending,
          write: async (records) => {
            pending = records;
          },
        },
        settingsStore: { read: async () => ({}) },
        defaults,
        librarySyncManifestDirectory: manifestDirectory,
        onPendingChanged: async () => {
          synced = true;
          return { enabled: true };
        },
      }),
    );
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/pending/stale`, {
        method: "DELETE",
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.removedCount, 1);
      assert.deepEqual(
        pending.map((item) => item.ItemId),
        ["keep", "deleted-history"],
      );
      assert.equal(synced, true);
    } finally {
      await close(server);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
