import assert from "node:assert/strict";
import test from "node:test";
import { collectScanItems, mergeUserMediaResponses } from "../src/services/scan-sources.js";
import { createDefaultSettings } from "../src/config/settings.js";
import { previewScan } from "../src/services/scan-engine.js";

function movie(userData) {
  return {
    Id: "movie-1",
    Name: "Movie",
    Type: "Movie",
    UserData: userData,
  };
}

function series(userData) {
  return {
    Id: "series-1",
    Name: "Series",
    Type: "Series",
    UserData: userData,
  };
}

function episode(userData) {
  return {
    Id: "episode-1",
    SeriesId: "series-1",
    Type: "Episode",
    UserData: userData,
  };
}

test("movie watch history is unknown when a selected user has no user data", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [movie({ PlayCount: 1 })] },
      { userId: "user-b", items: [movie(null)] },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].WatchHistoryKnown, false);
});

test("movie watch history is unknown when a selected user response omits the item", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [movie({ PlayCount: 0 })] },
      { userId: "user-b", items: [] },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].WatchHistoryKnown, false);
});

test("series episode watch history is unknown when any selected user lacks episode user data", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [series({ PlayCount: 0 })] },
      { userId: "user-b", items: [series({ PlayCount: 0 })] },
    ],
    episodeResponses: [
      { userId: "user-a", items: [episode({ PlayCount: 1, LastPlayedDate: "2025-01-01T00:00:00.000Z" })] },
      { userId: "user-b", items: [episode(null)] },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].EpisodeActivity.WatchHistoryKnown, false);
});

test("series episode watch history is unknown when a selected user has no episode response", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [series({ PlayCount: 0 })] },
      { userId: "user-b", items: [series({ PlayCount: 0 })] },
    ],
    episodeResponses: [
      { userId: "user-a", items: [episode({ PlayCount: 0 })] },
      { userId: "user-b", items: [] },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].EpisodeActivity.WatchHistoryKnown, false);
});

test("each selected user's movie history must be complete, even if another has an old date", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [movie({ PlayCount: 2, LastPlayedDate: "2020-01-01T00:00:00Z" })] },
      { userId: "user-b", items: [movie({ PlayCount: 0, Played: true })] },
    ],
  });
  assert.equal(items[0].UserData.Played, true);
  assert.equal(items[0].WatchHistoryKnown, false);
});

test("series history requires every episode to be represented for every selected user", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [series({ PlayCount: 0 })] },
      { userId: "user-b", items: [series({ PlayCount: 0 })] },
    ],
    episodeResponses: [
      { userId: "user-a", items: [episode({ PlayCount: 0 }), { ...episode({ PlayCount: 0 }), Id: "episode-2" }] },
      { userId: "user-b", items: [episode({ PlayCount: 0 })] },
    ],
  });
  assert.equal(items[0].EpisodeActivity.EpisodeCount, 2);
  assert.equal(items[0].EpisodeActivity.WatchHistoryKnown, false);
});

test("latest episode activity across users includes date bumps with zero play counts", () => {
  const items = mergeUserMediaResponses({
    userIds: ["user-a", "user-b"],
    itemResponses: [
      { userId: "user-a", items: [series({ PlayCount: 0 })] },
      { userId: "user-b", items: [series({ PlayCount: 0 })] },
    ],
    episodeResponses: [
      { userId: "user-a", items: [episode({ PlayCount: 1, LastPlayedDate: "2020-01-01T00:00:00Z" })] },
      { userId: "user-b", items: [episode({ PlayCount: 0, Played: true, LastPlayedDate: "2026-10-01T00:00:00Z" })] },
    ],
  });
  assert.equal(items[0].EpisodeActivity.WatchHistoryKnown, true);
  assert.equal(items[0].EpisodeActivity.PlayedEpisodeCount, 1);
  assert.equal(items[0].EpisodeActivity.LastPlayedDate, "2026-10-01T00:00:00.000Z");
});

for (const provider of ["emby", "jellyfin"]) {
  test(`${provider} scan requests complete supported movie and episode watch history`, async () => {
    const config = createDefaultSettings({ dataDirectory: "./data", logDirectory: "./logs" });
    config.MediaServer.Provider = provider;
    config.MediaServer.Locked = true;
    const server = config[provider === "emby" ? "Emby" : "Jellyfin"];
    server.ServerUrl = "http://media-server.test";
    server.ApiKey = "test-key";
    server.UserIds = ["user-a", "user-b"];
    server.SearchLibraries = ["Movies", "Shows"];
    config.Arrs.Radarr.Enabled = false;
    config.Arrs.Sonarr.Enabled = false;
    config.Mode.DaysOlderThan = 0;
    config.Mode.Type = "all";
    config.Mode.WatchedDays = 547;
    config.Mode.UnwatchedDays = 365;
    const itemTypes = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      assert.equal(options.method || "GET", "GET");
      const url = new URL(input);
      if (url.pathname === "/Library/VirtualFolders") {
        return Response.json([
          { ItemId: "movies", Name: "Movies", CollectionType: "movies" },
          { ItemId: "shows", Name: "Shows", CollectionType: "tvshows" },
        ]);
      }
      if (url.pathname.endsWith("/Items/Resume")) return Response.json({ Items: [] });
      assert.match(url.pathname, /^\/Users\/user-[ab]\/Items$/);
      assert.equal(url.searchParams.get("EnableUserData"), "true");
      const fields = url.searchParams.get("Fields").split(",");
      assert.equal(fields.includes("UserDataPlayCount"), provider === "emby");
      assert.equal(fields.includes("UserDataLastPlayedDate"), provider === "emby");
      const type = url.searchParams.get("IncludeItemTypes");
      itemTypes.push(type);
      const recentUser = url.pathname.includes("user-b");
      const UserData = {
        Played: true, PlayCount: recentUser ? 0 : 2,
        LastPlayedDate: recentUser ? "2026-10-01T00:00:00Z" : "2020-01-01T00:00:00Z",
      };
      const result = type === "Episode" ? episode(UserData)
        : type === "Movie" ? movie(UserData) : series({ PlayCount: 0 });
      return Response.json({ Items: [{ ...result, DateCreated: "2020-01-01T00:00:00Z" }] });
    };
    try {
      const collected = await collectScanItems(config);
      assert.deepEqual(itemTypes.sort(), ["Episode", "Episode", "Movie", "Movie", "Series", "Series"]);
      assert.equal(collected.items.length, 2);
      const preview = previewScan({
        items: collected.items, settings: config, now: new Date("2026-10-03T00:00:00Z"),
      });
      assert.equal(preview.candidates.length, 0);
      assert.equal(preview.summary.skipped["age-rule-not-met"], 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
