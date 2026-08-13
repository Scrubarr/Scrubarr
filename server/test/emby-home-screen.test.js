import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmbyLeavingSoonUserConfiguration,
  syncEmbyLeavingSoonUserPreferences,
} from "../src/services/emby.js";

const views = [
  { Name: "Movies", PresentationUniqueKey: "movies" },
  { Name: "TV shows", PresentationUniqueKey: "shows" },
  { Name: "Movies Leaving Soon", PresentationUniqueKey: "leaving-movies" },
  { Name: "Live TV", PresentationUniqueKey: "live-tv" },
  { Name: "Collections", PresentationUniqueKey: "collections" },
  { Name: "Shows Leaving Soon", PresentationUniqueKey: "leaving-shows" },
];

test("groups Leaving Soon libraries after primary libraries without reordering other views", () => {
  const result = buildEmbyLeavingSoonUserConfiguration({
    configuration: {
      OrderedViews: views.map((view) => view.PresentationUniqueKey),
      LatestItemsExcludes: ["collections"],
    },
    views,
    movieLibraryName: "Movies Leaving Soon",
    seriesLibraryName: "Shows Leaving Soon",
    primaryLibraryNames: ["Movies", "TV shows"],
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.configuration.OrderedViews, [
    "movies",
    "shows",
    "leaving-movies",
    "leaving-shows",
    "live-tv",
    "collections",
  ]);
  assert.deepEqual(result.configuration.LatestItemsExcludes, [
    "collections",
    "leaving-movies",
    "leaving-shows",
  ]);
});

test("can allow Leaving Soon media in secondary sections", () => {
  const result = buildEmbyLeavingSoonUserConfiguration({
    configuration: {
      OrderedViews: ["movies", "shows", "leaving-movies", "leaving-shows"],
      LatestItemsExcludes: ["leaving-movies", "other", "leaving-shows"],
    },
    views,
    movieLibraryName: "Movies Leaving Soon",
    seriesLibraryName: "Shows Leaving Soon",
    primaryLibraryNames: ["Movies", "TV shows"],
    includeInSecondarySections: true,
  });

  assert.deepEqual(result.configuration.LatestItemsExcludes, ["other"]);
});

test("uses the current Emby view order when OrderedViews is empty", () => {
  const result = buildEmbyLeavingSoonUserConfiguration({
    configuration: { OrderedViews: [], LatestItemsExcludes: [] },
    views,
    movieLibraryName: "Movies Leaving Soon",
    seriesLibraryName: "Shows Leaving Soon",
    primaryLibraryNames: ["Movies", "TV shows"],
  });

  assert.deepEqual(result.configuration.OrderedViews.slice(0, 4), [
    "movies",
    "shows",
    "leaving-movies",
    "leaving-shows",
  ]);
});

test("updates complete Emby user configurations without changing unrelated values", async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/Library/VirtualFolders/Query") {
      return Response.json({
        Items: [
          { Name: "Movies Leaving Soon", Guid: "leaving-movies" },
          { Name: "Shows Leaving Soon", Guid: "leaving-shows" },
        ],
      });
    }
    if (requestUrl.pathname === "/Users") {
      return Response.json([{ Id: "user-1", Name: "User 1" }]);
    }
    if (requestUrl.pathname === "/Users/user-1") {
      return Response.json({
        Configuration: {
          OrderedViews: ["movies", "shows", "leaving-movies", "live-tv", "leaving-shows"],
          LatestItemsExcludes: [],
          PlayDefaultAudioTrack: true,
        },
      });
    }
    if (requestUrl.pathname === "/Users/user-1/Views") {
      return Response.json({ Items: views });
    }
    if (requestUrl.pathname === "/Users/user-1/Configuration") {
      posts.push(JSON.parse(options.body));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${requestUrl.pathname}`);
  };

  try {
    const result = await syncEmbyLeavingSoonUserPreferences({
      ServerUrl: "http://emby.local:8096",
      ApiKey: "test-key",
      SearchLibraries: ["Movies", "TV shows"],
    }, {
      movieLibraryName: "Movies Leaving Soon",
      seriesLibraryName: "Shows Leaving Soon",
    });

    assert.equal(result.updated, 1);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].PlayDefaultAudioTrack, true);
    assert.deepEqual(posts[0].OrderedViews.slice(0, 4), [
      "movies",
      "shows",
      "leaving-movies",
      "leaving-shows",
    ]);
    assert.deepEqual(posts[0].LatestItemsExcludes, [
      "leaving-movies",
      "leaving-shows",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rolls back earlier users when a later Emby preference update fails", async () => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname === "/Library/VirtualFolders/Query") {
      return Response.json({
        Items: [
          { Name: "Movies Leaving Soon", Guid: "leaving-movies" },
          { Name: "Shows Leaving Soon", Guid: "leaving-shows" },
        ],
      });
    }
    if (requestUrl.pathname === "/Users") {
      return Response.json([
        { Id: "user-1", Name: "User 1" },
        { Id: "user-2", Name: "User 2" },
      ]);
    }
    if (/^\/Users\/user-[12]$/.test(requestUrl.pathname)) {
      return Response.json({
        Configuration: {
          OrderedViews: ["movies", "shows", "leaving-movies", "live-tv", "leaving-shows"],
          LatestItemsExcludes: [],
        },
      });
    }
    if (/^\/Users\/user-[12]\/Views$/.test(requestUrl.pathname)) {
      return Response.json({ Items: views });
    }
    if (/^\/Users\/user-[12]\/Configuration$/.test(requestUrl.pathname)) {
      posts.push({ path: requestUrl.pathname, body: JSON.parse(options.body) });
      if (requestUrl.pathname === "/Users/user-2/Configuration") {
        return Response.json({ error: "failed" }, { status: 500 });
      }
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${requestUrl.pathname}`);
  };

  try {
    await assert.rejects(
      syncEmbyLeavingSoonUserPreferences({
        ServerUrl: "http://emby.local:8096",
        ApiKey: "test-key",
        SearchLibraries: ["Movies", "TV shows"],
      }, {
        movieLibraryName: "Movies Leaving Soon",
        seriesLibraryName: "Shows Leaving Soon",
      }),
      /Previous user changes were rolled back/,
    );
    assert.equal(posts.filter((entry) => entry.path === "/Users/user-1/Configuration").length, 2);
    assert.deepEqual(posts.at(-1).body.LatestItemsExcludes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
