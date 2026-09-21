import assert from "node:assert/strict";
import test from "node:test";
import { syncJellyfinLeavingSoonUserPreferences } from "../src/services/jellyfin.js";
import { buildLeavingSoonUserConfiguration } from "../src/services/user-library-presentation.js";

const views = [
  { Name: "Movies", Id: "movies" },
  { Name: "TV Shows", Id: "shows" },
  { Name: "Movies Leaving Soon", Id: "leaving-movies" },
  { Name: "Shows Leaving Soon", Id: "leaving-shows" },
  { Name: "Collections", Id: "collections" },
];

test("groups Jellyfin libraries using view IDs and preserves unrelated preferences", () => {
  const result = buildLeavingSoonUserConfiguration({
    configuration: {
      OrderedViews: [],
      LatestItemsExcludes: ["collections"],
      RememberAudioSelections: true,
    },
    views,
    movieLibraryName: "Movies Leaving Soon",
    seriesLibraryName: "Shows Leaving Soon",
    primaryLibraryNames: ["Movies", "TV Shows"],
  });

  assert.deepEqual(result.configuration.OrderedViews, [
    "movies",
    "shows",
    "leaving-movies",
    "leaving-shows",
    "collections",
  ]);
  assert.deepEqual(result.configuration.LatestItemsExcludes, [
    "collections",
    "leaving-movies",
    "leaving-shows",
  ]);
  assert.equal(result.configuration.RememberAudioSelections, true);
});

test("updates Jellyfin user presentation through Jellyfin endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/Library/VirtualFolders") {
      return Response.json([
        { Name: "Movies Leaving Soon", ItemId: "leaving-movies" },
        { Name: "Shows Leaving Soon", ItemId: "leaving-shows" },
      ]);
    }
    if (requestUrl.pathname === "/Users") {
      return Response.json([{ Id: "user-1", Name: "User 1" }]);
    }
    if (requestUrl.pathname === "/Users/user-1") {
      return Response.json({
        Configuration: {
          OrderedViews: ["movies", "shows", "leaving-movies", "collections", "leaving-shows"],
          LatestItemsExcludes: [],
          RememberSubtitleSelections: true,
        },
      });
    }
    if (requestUrl.pathname === "/Users/user-1/Views") {
      return Response.json({ Items: views });
    }
    if (requestUrl.pathname === "/Users/user-1/Configuration") {
      posts.push({
        headers: options.headers,
        body: JSON.parse(options.body),
      });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${requestUrl.pathname}`);
  };

  try {
    const result = await syncJellyfinLeavingSoonUserPreferences({
      ServerUrl: "http://jellyfin.local:8096",
      ApiKey: "test-key",
      SearchLibraries: ["Movies", "TV Shows"],
    }, {
      movieLibraryName: "Movies Leaving Soon",
      seriesLibraryName: "Shows Leaving Soon",
    });

    assert.equal(result.updated, 1);
    assert.equal(posts.length, 1);
    assert.match(posts[0].headers.Authorization, /Token="test-key"/);
    assert.equal(posts[0].body.RememberSubtitleSelections, true);
    assert.deepEqual(posts[0].body.OrderedViews, [
      "movies",
      "shows",
      "leaving-movies",
      "leaving-shows",
      "collections",
    ]);
    assert.deepEqual(posts[0].body.LatestItemsExcludes, [
      "leaving-movies",
      "leaving-shows",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("can allow Jellyfin Leaving Soon media in secondary sections", () => {
  const result = buildLeavingSoonUserConfiguration({
    configuration: {
      OrderedViews: views.map((view) => view.Id),
      LatestItemsExcludes: ["leaving-movies", "collections", "leaving-shows"],
    },
    views,
    movieLibraryName: "Movies Leaving Soon",
    seriesLibraryName: "Shows Leaving Soon",
    keepTogether: false,
    includeInSecondarySections: true,
  });

  assert.deepEqual(result.configuration.OrderedViews, views.map((view) => view.Id));
  assert.deepEqual(result.configuration.LatestItemsExcludes, ["collections"]);
});
