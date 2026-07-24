import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { revalidateDuePendingItems } from "../src/services/deletion-revalidation.js";

function settings() {
  const config = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  config.Mode.Type = "all";
  config.Mode.DaysOlderThan = 0;
  return config;
}

function currentItem(overrides = {}) {
  return {
    ItemId: "movie-1",
    Title: "Old Movie",
    Type: "Movie",
    Year: 2020,
    UserData: { PlayCount: 0, LastPlayedDate: null },
    WatchHistoryKnown: true,
    DateCreated: "2020-01-01T00:00:00.000Z",
    ArrDateAdded: "2020-01-01T00:00:00.000Z",
    Arr: "Radarr",
    ArrId: 42,
    ProviderIds: { Tmdb: "123" },
    Path: "/media/old-movie.mkv",
    ArrPath: "/media/old-movie",
    Genres: [],
    ...overrides,
  };
}

function pendingItem(overrides = {}) {
  return {
    ItemId: "movie-1",
    Title: "Old Movie",
    Type: "Movie",
    Year: 2020,
    MarkedDate: "2026-06-01",
    Arr: "Radarr",
    ArrId: 42,
    ProviderIds: { Tmdb: "123" },
    Path: "/media/old-movie",
    ...overrides,
  };
}

test("final revalidation allows an unchanged item that still meets rules", async () => {
  const due = pendingItem();
  const result = await revalidateDuePendingItems({
    settings: settings(),
    pending: [due],
    dueItems: [due],
    now: new Date("2026-06-20T00:00:00.000Z"),
    collectItems: async () => ({ items: [currentItem()], warnings: [] }),
  });

  assert.equal(result.allowedItems.length, 1);
  assert.equal(result.deferredItems.length, 0);
  assert.equal(result.allowedItems[0].ArrId, 42);
});

test("final revalidation defers an item watched after it entered pending", async () => {
  const due = pendingItem();
  const result = await revalidateDuePendingItems({
    settings: settings(),
    pending: [due],
    dueItems: [due],
    now: new Date("2026-06-20T00:00:00.000Z"),
    collectItems: async () => ({
      items: [currentItem({
        UserData: { PlayCount: 1, LastPlayedDate: "2026-06-19T00:00:00.000Z" },
      })],
    }),
  });

  assert.equal(result.allowedItems.length, 0);
  assert.equal(result.deferredItems[0].SkipCode, "age-rule-not-met");
});

test("final revalidation defers a newly excluded pending item", async () => {
  const due = pendingItem();
  const result = await revalidateDuePendingItems({
    settings: settings(),
    pending: [due],
    exclusions: [{ ItemId: "movie-1", Type: "Movie", Title: "Old Movie" }],
    dueItems: [due],
    collectItems: async () => ({ items: [currentItem()] }),
  });

  assert.equal(result.allowedItems.length, 0);
  assert.equal(result.deferredItems[0].SkipCode, "excluded");
});

test("final revalidation defers an Arr identity mismatch", async () => {
  const due = pendingItem();
  const result = await revalidateDuePendingItems({
    settings: settings(),
    pending: [due],
    dueItems: [due],
    collectItems: async () => ({ items: [currentItem({ ArrId: 99 })] }),
  });

  assert.equal(result.allowedItems.length, 0);
  assert.equal(result.deferredItems[0].SkipCode, "arr-identity-changed");
});

test("final revalidation fails closed when current media data is unavailable", async () => {
  const due = pendingItem();
  const result = await revalidateDuePendingItems({
    settings: settings(),
    pending: [due],
    dueItems: [due],
    collectItems: async () => {
      throw new Error("Emby connection failed");
    },
  });

  assert.equal(result.allowedItems.length, 0);
  assert.equal(result.deferredItems[0].SkipCode, "revalidation-unavailable");
});
