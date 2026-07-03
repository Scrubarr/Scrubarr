import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import {
  appendExclusion,
  evaluateQueueCommit,
  exclusionFromPending,
  formatDateInTimezone,
  removePendingItem,
} from "../src/services/pending-queue.js";

const runtime = { logDirectory: "./logs" };
const now = new Date("2026-06-07T13:30:00.000Z");

function candidateItem(overrides = {}) {
  return {
    ItemId: "movie-1",
    Title: "Example Movie",
    Type: "Movie",
    Year: 2020,
    Path: "/media/example",
    ArrPath: "/media/example",
    Arr: "Radarr",
    ArrId: 5,
    ArrDateAdded: "2020-01-01T00:00:00.000Z",
    UserData: { PlayCount: 0, LastPlayedDate: null },
    ...overrides,
  };
}

test("formats the marked date in the configured timezone", () => {
  assert.equal(formatDateInTimezone(now, "Pacific/Auckland"), "2026-06-08");
  assert.equal(formatDateInTimezone(now, "UTC"), "2026-06-07");
});

test("creates compatible pending records in preview-only and live modes", () => {
  const settings = createDefaultSettings(runtime);
  settings.Mode.Type = "all";
  const result = evaluateQueueCommit({
    selectedItemIds: ["movie-1"],
    items: [candidateItem()],
    settings,
    exclusions: [],
    pending: [],
    now,
    timezone: "Pacific/Auckland",
  });

  assert.equal(result.records.length, 1);
  assert.deepEqual(
    {
      Title: result.records[0].Title,
      Type: result.records[0].Type,
      Year: result.records[0].Year,
      Path: result.records[0].Path,
      ItemId: result.records[0].ItemId,
      Arr: result.records[0].Arr,
      ArrId: result.records[0].ArrId,
      MarkedDate: result.records[0].MarkedDate,
      Notified: result.records[0].Notified,
      Deleted: result.records[0].Deleted,
    },
    {
      Title: "Example Movie",
      Type: "Movie",
      Year: 2020,
      Path: "/media/example",
      ItemId: "movie-1",
      Arr: "Radarr",
      ArrId: 5,
      MarkedDate: "2026-06-08",
      Notified: [],
      Deleted: null,
    },
  );
  assert.equal(result.records[0].HasPrimaryImage, false);
  assert.match(result.records[0].Reason, /Unwatched and added/);
  assert.deepEqual(result.records[0].QualificationReasons, [
    "Unwatched and added 2349 days ago (180+ days)",
    "Arr added 2349 days ago (365+ day minimum)",
  ]);
  assert.equal(result.records[0].DateSource, "arr");
  assert.equal(result.records[0].QualifyingDate, "2020-01-01T00:00:00.000Z");

  settings.CleanupRules.DryRun = false;
  const liveResult = evaluateQueueCommit({
    selectedItemIds: ["movie-1"],
    items: [candidateItem()],
    settings,
    exclusions: [],
    pending: [],
    now,
    timezone: "UTC",
  });
  assert.equal(liveResult.records.length, 1);
  assert.equal(liveResult.records[0].MarkedDate, "2026-06-07");
});

test("rechecks exclusions, duplicates, and caps before committing", () => {
  const settings = createDefaultSettings(runtime);
  settings.Mode.Type = "all";
  settings.Limits.MaxMoviesMarked = 2;
  const result = evaluateQueueCommit({
    selectedItemIds: ["excluded", "pending", "allowed", "over-limit"],
    items: [
      candidateItem({ ItemId: "excluded", Title: "Excluded" }),
      candidateItem({ ItemId: "pending", Title: "Pending" }),
      candidateItem({ ItemId: "allowed", Title: "Allowed" }),
      candidateItem({ ItemId: "over-limit", Title: "Over Limit" }),
    ],
    settings,
    exclusions: [{ ItemId: "excluded", Title: "Excluded", Type: "Movie" }],
    pending: [{ ItemId: "pending", Title: "Pending", Type: "Movie" }],
    now,
    timezone: "UTC",
  });

  assert.deepEqual(result.records.map((record) => record.ItemId), ["allowed"]);
  assert.deepEqual(result.skippedItemIds.sort(), [
    "excluded",
    "over-limit",
    "pending",
  ]);
});

test("removes pending items and creates compatible exclusions", () => {
  const pending = [
    {
      ItemId: "series-1",
      Title: "Example Series",
      Type: "Series",
      Arr: "Sonarr",
      ArrId: 9,
      HasPrimaryImage: true,
      Reason: "Last played 400 days ago",
      DateSource: "emby-last-played",
      QualifyingDate: "2025-01-01T00:00:00.000Z",
      SeriesInactiveDays: 400,
    },
  ];
  const result = removePendingItem(pending, "series-1");
  const exclusion = exclusionFromPending(result.removed);
  const exclusions = appendExclusion([], exclusion);
  const duplicate = appendExclusion(exclusions, exclusion);

  assert.equal(result.remaining.length, 0);
  assert.deepEqual(exclusion, {
    Title: "Example Series",
    Type: "Series",
    ItemId: "series-1",
    Arr: "Sonarr",
    ArrId: 9,
    HasPrimaryImage: true,
    Reason: "Last played 400 days ago",
    DateSource: "emby-last-played",
    QualifyingDate: "2025-01-01T00:00:00.000Z",
    SeriesInactiveDays: 400,
  });
  assert.equal(duplicate.length, 1);
});
