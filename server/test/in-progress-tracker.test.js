import assert from "node:assert/strict";
import test from "node:test";
import { applyInProgressTracking } from "../src/services/in-progress-tracker.js";

test("records first seen date for current in-progress media", () => {
  const now = new Date("2026-06-18T12:00:00.000Z");
  const result = applyInProgressTracking({
    now,
    records: [],
    items: [
      {
        ItemId: "movie-1",
        Title: "Resume Movie",
        Type: "Movie",
        InProgress: true,
      },
    ],
  });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].FirstSeenDate, now.toISOString());
  assert.equal(result.records[0].LastSeenDate, now.toISOString());
  assert.equal(result.items[0].InProgressSince, now.toISOString());
});

test("preserves first seen date while refreshing last seen date", () => {
  const result = applyInProgressTracking({
    now: new Date("2026-06-18T12:00:00.000Z"),
    records: [
      {
        ItemId: "series-1",
        Title: "Resume Series",
        Type: "Series",
        FirstSeenDate: "2026-01-01T00:00:00.000Z",
        LastSeenDate: "2026-01-05T00:00:00.000Z",
      },
    ],
    items: [
      {
        ItemId: "series-1",
        Title: "Resume Series",
        Type: "Series",
        InProgress: true,
      },
    ],
  });

  assert.equal(result.records[0].FirstSeenDate, "2026-01-01T00:00:00.000Z");
  assert.equal(result.records[0].LastSeenDate, "2026-06-18T12:00:00.000Z");
  assert.equal(result.items[0].InProgressSince, "2026-01-01T00:00:00.000Z");
});

test("removes records for media no longer in progress", () => {
  const result = applyInProgressTracking({
    now: new Date("2026-06-18T12:00:00.000Z"),
    records: [
      {
        ItemId: "movie-1",
        Title: "Resume Movie",
        Type: "Movie",
        FirstSeenDate: "2026-01-01T00:00:00.000Z",
        LastSeenDate: "2026-01-05T00:00:00.000Z",
      },
    ],
    items: [
      {
        ItemId: "movie-1",
        Title: "Resume Movie",
        Type: "Movie",
        InProgress: false,
      },
    ],
  });

  assert.deepEqual(result.records, []);
  assert.equal(result.items[0].InProgressSince, undefined);
});
