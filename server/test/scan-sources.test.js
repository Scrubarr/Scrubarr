import assert from "node:assert/strict";
import test from "node:test";
import { mergeUserMediaResponses } from "../src/services/scan-sources.js";

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
