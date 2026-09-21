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

const cachedExclusion = {
  ItemId: "old-id",
  Title: "Protected Movie",
  Type: "Movie",
  Year: 2005,
  HasPrimaryImage: true,
  Arr: "Radarr",
  ArrId: 7,
};

const replacementMedia = {
  Id: "current-id",
  Name: "Protected Movie",
  Type: "Movie",
  ProductionYear: 2005,
  ImageTags: { Primary: "poster" },
  ProviderIds: { Tmdb: "101" },
};

async function exclusionImageFixture(t, {
  item = cachedExclusion,
  media = [replacementMedia],
  directMedia = [],
  images = { "current-id": "replacement-image" },
  provider = "emby",
} = {}) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const writes = [];
  let stored = [structuredClone(item)];
  const defaults = createDefaultSettings({});
  defaults.MediaServer = { Provider: provider, Locked: true };
  const config = defaults[provider === "jellyfin" ? "Jellyfin" : "Emby"];
  config.ServerUrl = "http://media.invalid";
  config.ApiKey = "test-key";
  config.SearchLibraries = ["Movies"];
  defaults.Arrs.Radarr = {
    Enabled: true,
    Url: "http://radarr.invalid",
    ApiKey: "test-key",
  };
  if (item.Type === "Series") {
    defaults.Arrs.Radarr.Enabled = false;
    defaults.Arrs.Sonarr = {
      Enabled: true,
      Url: "http://sonarr.invalid",
      ApiKey: "test-key",
    };
  }
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const parsed = new URL(String(url));
    requests.push(`${parsed.hostname}${parsed.pathname}${parsed.search}`);
    assert.equal(options.method || "GET", "GET", "external mocks are read-only");
    if (parsed.hostname === "media.invalid") {
      const imageMatch = /^\/Items\/([^/]+)\/Images\/Primary$/.exec(parsed.pathname);
      if (imageMatch) {
        const value = images[decodeURIComponent(imageMatch[1])] ?? 404;
        return typeof value === "number"
          ? new Response(null, { status: value })
          : new Response(value, { headers: { "Content-Type": "image/jpeg" } });
      }
      if (parsed.pathname === "/Library/VirtualFolders") {
        return Response.json([{
          ItemId: "library-1",
          Name: "Movies",
          CollectionType: item.Type === "Series" ? "tvshows" : "movies",
        }]);
      }
      if (parsed.pathname === "/Items") {
        return Response.json({
          Items: parsed.searchParams.has("Ids") ? directMedia : media,
        });
      }
    }
    if (parsed.hostname === "radarr.invalid" && parsed.pathname === "/api/v3/movie") {
      return Response.json([{ id: 7, tmdbId: 101 }, { id: 99, tmdbId: 202 }]);
    }
    if (parsed.hostname === "sonarr.invalid" && parsed.pathname === "/api/v3/series") {
      return Response.json([{ id: 7, tvdbId: 101 }]);
    }
    assert.fail(`Unexpected external request: ${parsed.hostname}${parsed.pathname}`);
  });

  const app = express();
  app.use(express.json());
  app.use("/api/exclusions", createExclusionsRouter({
    exclusionsStore: {
      read: async () => structuredClone(stored),
      write: async (value) => {
        stored = structuredClone(value);
        writes.push(structuredClone(value));
      },
    },
    pendingStore: { read: async () => [], write: async () => {} },
    settingsStore: { read: async () => ({}) },
    defaults,
  }));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(() => close(server));
  return {
    requests,
    writes,
    stored: () => structuredClone(stored),
    request: (route = "", options) => originalFetch(
      `http://127.0.0.1:${port}/api/exclusions${route}`,
      options,
    ),
  };
}

for (const provider of ["emby", "jellyfin"]) {
  test(`${provider} stale exclusion images resolve despite cached image and year details`, async (t) => {
    const fixture = await exclusionImageFixture(t, { provider });
    const list = await (await fixture.request()).json();
    assert.equal(list[0].ItemId, "old-id");
    assert.equal(list[0].HasPrimaryImage, true);
    assert.equal(list[0].Year, 2005);
    assert.deepEqual(fixture.requests, []);

    const image = await fixture.request("/image/old-id");
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal(await image.text(), "replacement-image");
    assert.equal(fixture.requests.filter((url) => url.includes("SearchTerm=")).length, 1);
    assert.equal(fixture.requests.filter((url) => url.includes("/api/v3/movie")).length, 1);
    assert.deepEqual(fixture.stored(), [cachedExclusion]);
    assert.deepEqual(fixture.writes, []);

    const again = await fixture.request("/image/old-id");
    assert.equal(await again.text(), "replacement-image");
    assert.equal(fixture.requests.filter((url) => url.includes("SearchTerm=")).length, 1);
  });
}

test("normal exclusion images do not trigger detail or Arr resolution", async (t) => {
  const fixture = await exclusionImageFixture(t, { images: { "old-id": "normal-image" } });
  await (await fixture.request()).json();
  const image = await fixture.request("/image/old-id");
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "normal-image");
  assert.equal(fixture.requests.length, 1);
  assert.match(fixture.requests[0], /\/Items\/old-id\/Images\/Primary/);
  assert.deepEqual(fixture.writes, []);
});

test("stale series exclusion images resolve through Sonarr identity", async (t) => {
  const fixture = await exclusionImageFixture(t, {
    item: { ...cachedExclusion, Type: "Series", Arr: "Sonarr" },
    media: [{ ...replacementMedia, Type: "Series", ProviderIds: { Tvdb: "101" } }],
  });
  const image = await fixture.request("/image/old-id");
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "replacement-image");
  assert.equal(fixture.requests.filter((url) => url.includes("/api/v3/series")).length, 1);
  assert.deepEqual(fixture.writes, []);
});

test("stale exclusion image fallback accepts provider identity without Arr lookup", async (t) => {
  const fixture = await exclusionImageFixture(t, {
    item: { ...cachedExclusion, Arr: null, ArrId: null, ProviderIds: { tmdb: 101 } },
  });
  const image = await fixture.request("/image/old-id");
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "replacement-image");
  assert.equal(fixture.requests.some((url) => url.includes("radarr.invalid")), false);
});

for (const [label, options] of [
  ["unrelated same-title and year", {
    media: [{ ...replacementMedia, ProviderIds: { Tmdb: "202" } }],
  }],
  ["title-only identity", {
    item: { ...cachedExclusion, Arr: null, ArrId: null },
  }],
  ["zero provider IDs", {
    item: { ...cachedExclusion, Arr: null, ArrId: null, ProviderIds: { Tmdb: 0 } },
    media: [{ ...replacementMedia, ProviderIds: { Tmdb: "0" } }],
  }],
  ["conflicting provider despite matching Arr", {
    item: { ...cachedExclusion, ProviderIds: { Tmdb: "202" } },
  }],
  ["conflicting provider despite another provider match", {
    item: { ...cachedExclusion, Arr: null, ArrId: null, ProviderIds: { Tmdb: "101", Imdb: "tt123" } },
    media: [{ ...replacementMedia, ProviderIds: { Tmdb: "101", Imdb: "tt456" } }],
  }],
  ["wrong media type", {
    item: { ...cachedExclusion, ProviderIds: { Tmdb: "101" } },
    media: [{ ...replacementMedia, Type: "Series" }],
  }],
  ["ambiguous identity", {
    media: [replacementMedia, { ...replacementMedia, Id: "other-current-id" }],
  }],
]) {
  test(`stale exclusion image fallback rejects ${label}`, async (t) => {
    const fixture = await exclusionImageFixture(t, options);
    const image = await fixture.request("/image/old-id");
    assert.equal(image.status, 404);
    assert.equal(fixture.requests.some((url) => url.includes("/Items/current-id/Images")), false);
    assert.deepEqual(fixture.writes, []);
  });
}

test("exclusion enrichment and image fallback preserve the stored removal ID", async (t) => {
  const fixture = await exclusionImageFixture(t, {
    item: { ...cachedExclusion, Year: null },
  });
  const listed = await (await fixture.request()).json();
  assert.equal(listed[0].ItemId, "old-id");
  assert.equal(listed[0].Year, 2005);
  const searched = await (await fixture.request("/search?q=protected")).json();
  assert.equal(searched.items[0].ItemId, "old-id");
  assert.equal(searched.items[0].ExclusionItemId, "old-id");
  const image = await fixture.request("/image/old-id");
  assert.equal(await image.text(), "replacement-image");
  assert.deepEqual(fixture.writes, []);

  const removed = await fixture.request(`/${listed[0].ItemId}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(fixture.stored(), []);
  assert.deepEqual(fixture.writes, [[]]);
  const afterRemoval = await fixture.request("/image/old-id");
  assert.equal(afterRemoval.status, 404);
});

test("missing exclusion image fallback caches negative results", async (t) => {
  const fixture = await exclusionImageFixture(t, { media: [] });
  const images = await Promise.all([
    fixture.request("/image/old-id"),
    fixture.request("/image/old-id"),
  ]);
  assert.deepEqual(images.map((image) => image.status), [404, 404]);
  assert.equal(fixture.requests.filter((url) => url.includes("SearchTerm=")).length, 1);
});

test("external image failures do not trigger searches during service errors", async (t) => {
  const fixture = await exclusionImageFixture(t, { images: { "old-id": 503 } });
  const image = await fixture.request("/image/old-id");
  assert.equal(image.status, 404);
  assert.equal(fixture.requests.length, 1);
});

test("missing images for non-excluded items do not trigger exclusion searches", async (t) => {
  const fixture = await exclusionImageFixture(t);
  const image = await fixture.request("/image/not-excluded");
  assert.equal(image.status, 404);
  assert.equal(fixture.requests.length, 1);
});
