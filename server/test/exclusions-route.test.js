import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createDefaultSettings } from "../src/config/settings.js";
import { createExclusionsRouter } from "../src/routes/exclusions.js";

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

test("exclusions search only returns existing exclusions", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/exclusions",
    createExclusionsRouter({
      exclusionsStore: {
        read: async () => [
          {
            ItemId: "excluded-1",
            Title: "Batman Begins",
            Type: "Movie",
            Year: 2005,
            HasPrimaryImage: true,
          },
          {
            ItemId: "excluded-2",
            Title: "Mr Inbetween",
            Type: "Series",
            Year: 2018,
            HasPrimaryImage: true,
          },
        ],
        write: async () => {},
      },
      pendingStore: {
        read: async () => [],
        write: async () => {},
      },
      settingsStore: {
        read: async () => ({}),
      },
      defaults: { Emby: {} },
    }),
  );
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/exclusions/search?q=batman`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].Title, "Batman Begins");
    assert.equal(body.items[0].Excluded, true);
  } finally {
    await close(server);
  }
});

test("stale exclusion removal rechecks records and preserves newer exclusions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-exclusions-"));
  const existingPath = path.join(directory, "still-present.mkv");
  await fs.writeFile(existingPath, "test", "utf8");

  const stale = {
    ItemId: "stale-1",
    Title: "Missing Movie",
    Type: "Movie",
    Path: path.join(directory, "missing.mkv"),
  };
  const newer = {
    ItemId: "newer-1",
    Title: "Current Movie",
    Type: "Movie",
    Path: existingPath,
  };
  let reads = 0;
  let written = null;

  const app = express();
  app.use(express.json());
  app.use(
    "/api/exclusions",
    createExclusionsRouter({
      exclusionsStore: {
        read: async () => {
          reads += 1;
          return reads === 1 ? [stale] : [stale, newer];
        },
        write: async (value) => {
          written = value;
        },
      },
      pendingStore: {
        read: async () => [],
        write: async () => {},
      },
      settingsStore: {
        read: async () => ({}),
      },
      defaults: createDefaultSettings({
        dataDirectory: directory,
        logDirectory: directory,
      }),
      integrityReport: async () => ({
        items: [{ key: "Movie|stale-1" }],
        reviewItems: [],
        warnings: [],
      }),
    }),
  );
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/exclusions/stale`,
      { method: "DELETE" },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.removedCount, 1);
    assert.equal(body.removed[0].ItemId, "stale-1");
    assert.deepEqual(written, [newer]);
  } finally {
    await close(server);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("exclusion integrity reuses a short-lived report for unchanged data", async () => {
  let checks = 0;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/exclusions",
    createExclusionsRouter({
      exclusionsStore: {
        read: async () => [{ ItemId: "item-1", Title: "Cached Movie", Type: "Movie" }],
        write: async () => {},
      },
      pendingStore: { read: async () => [], write: async () => {} },
      settingsStore: { read: async () => ({}) },
      defaults: { Emby: {} },
      integrityReport: async () => {
        checks += 1;
        return { status: "clean", items: [], reviewItems: [], warnings: [] };
      },
    }),
  );
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/exclusions/integrity`),
      fetch(`http://127.0.0.1:${port}/api/exclusions/integrity`),
    ]);
    await fetch(`http://127.0.0.1:${port}/api/exclusions/integrity`);
    assert.equal(checks, 1);
  } finally {
    await close(server);
  }
});
