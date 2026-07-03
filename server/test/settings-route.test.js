import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { createSettingsRouter } from "../src/routes/settings.js";

class MemoryStore {
  constructor(value) {
    this.value = value;
    this.writes = 0;
  }

  async read() {
    return this.value;
  }

  async write(value) {
    this.value = value;
    this.writes += 1;
  }
}

async function withSettingsApp(settings, callback) {
  const defaults = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  const settingsStore = new MemoryStore(settings);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/settings",
    createSettingsRouter({
      settingsStore,
      defaults,
    }),
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const port = server.address().port;
    return await callback({
      settingsStore,
      baseUrl: `http://127.0.0.1:${port}`,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("settings route rejects provider changes after media server is locked", async () => {
  const current = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  current.MediaServer = { Provider: "emby", Locked: true };
  current.Emby.ApiKey = "emby-key";

  await withSettingsApp(current, async ({ baseUrl, settingsStore }) => {
    const submitted = structuredClone(current);
    submitted.MediaServer.Provider = "jellyfin";
    submitted.Jellyfin.ServerUrl = "http://jellyfin.local:8096";
    submitted.Jellyfin.ApiKey = "jellyfin-key";

    const response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitted),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(settingsStore.writes, 0);
    assert.deepEqual(body, {
      error: "invalid_settings",
      details: [
        "MediaServer.Provider cannot be changed after the provider is locked",
      ],
    });
  });
});

test("settings route allows an unlocked install to lock Jellyfin", async () => {
  const current = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  current.MediaServer = { Provider: "emby", Locked: false };

  await withSettingsApp(current, async ({ baseUrl, settingsStore }) => {
    const submitted = structuredClone(current);
    submitted.MediaServer = { Provider: "jellyfin", Locked: true };
    submitted.Jellyfin.ServerUrl = "http://jellyfin.local:8096";
    submitted.Jellyfin.ApiKey = "jellyfin-key";
    submitted.Jellyfin.SearchLibraries = ["Movies", "Shows"];

    const response = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitted),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(settingsStore.writes, 1);
    assert.equal(settingsStore.value.MediaServer.Provider, "jellyfin");
    assert.equal(settingsStore.value.MediaServer.Locked, true);
    assert.equal(settingsStore.value.Jellyfin.ApiKey, "jellyfin-key");
    assert.equal(body.settings.Jellyfin.ApiKey, "");
    assert.equal(body.settings.Jellyfin.ApiKeyConfigured, true);
  });
});

test("settings route tests Jellyfin connections with Jellyfin auth headers", async () => {
  const current = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  current.MediaServer = { Provider: "jellyfin", Locked: true };
  current.Jellyfin.ServerUrl = "http://jellyfin.local:8096/";
  current.Jellyfin.ApiKey = "jellyfin-key";

  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const urlString = String(url);
    if (!urlString.startsWith("http://jellyfin.local:8096/")) {
      return originalFetch(url, options);
    }
    calls.push({ url: urlString, headers: options.headers || {} });
    return new Response(
      JSON.stringify({
        ServerName: "Scrubarr Jellyfin Test",
        Version: "10.11.11",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    await withSettingsApp(current, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/settings/test/jellyfin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        name: "Scrubarr Jellyfin Test",
        version: "10.11.11",
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://jellyfin.local:8096/System/Info");
  assert.match(calls[0].headers.Authorization, /MediaBrowser Client="Scrubarr"/);
  assert.match(calls[0].headers.Authorization, /Token="jellyfin-key"/);
});

test("settings route excludes managed deletion libraries from search library picker", async () => {
  const current = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  current.MediaServer = { Provider: "emby", Locked: true };
  current.Emby.ServerUrl = "http://emby.local:8096";
  current.Emby.ApiKey = "emby-key";
  current.Emby.SearchLibraries = [
    "Movies",
    "Movies Leaving Soon",
    "Shows Leaving Soon",
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const urlString = String(url);
    if (!urlString.startsWith("http://emby.local:8096/")) {
      return originalFetch(url, options);
    }
    assert.equal(options.headers?.["X-Emby-Token"], "emby-key");
    return new Response(
      JSON.stringify([
        {
          Name: "Movies",
          ItemId: "movies",
          CollectionType: "movies",
        },
        {
          Name: "Movies Leaving Soon",
          ItemId: "movies-leaving-soon",
          CollectionType: "movies",
        },
        {
          Name: "Shows Leaving Soon",
          ItemId: "shows-leaving-soon",
          CollectionType: "tvshows",
        },
        {
          Name: "TV shows",
          ItemId: "tv",
          CollectionType: "tvshows",
        },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    await withSettingsApp(current, async ({ baseUrl }) => {
      const response = await fetch(`${baseUrl}/api/settings/media-server/libraries`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(
        body.libraries.map((library) => library.name),
        ["Movies", "TV shows"],
      );
      assert.deepEqual(body.selectedLibraries, ["Movies"]);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
