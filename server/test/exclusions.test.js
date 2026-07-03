import assert from "node:assert/strict";
import test from "node:test";
import { getProviderId } from "../src/services/arr-resolver.js";
import {
  isSameExclusion,
  markExcluded,
  normalizeExclusion,
} from "../src/services/exclusions.js";

test("normalizes a compatible exclusion record", () => {
  assert.deepEqual(
    normalizeExclusion({
      ItemId: " 123 ",
      Title: " Example ",
      Type: "Movie",
      Year: 2024,
      Arr: "Radarr",
      ArrId: 88,
      Unexpected: "ignored",
    }),
    {
      ItemId: "123",
      Title: "Example",
      Type: "Movie",
      Year: 2024,
      Arr: "Radarr",
      ArrId: 88,
    },
  );
});

test("rejects incomplete exclusion records", () => {
  assert.throws(
    () => normalizeExclusion({ ItemId: "123", Type: "Movie" }),
    /required/,
  );
});

test("preserves optional preview details on exclusion records", () => {
  assert.deepEqual(
    normalizeExclusion({
      ItemId: "123",
      Title: "Example",
      Type: "Series",
      Year: 2024,
      Path: "/media/example",
      HasPrimaryImage: true,
      Reason: "Last played 400 days ago",
      DateSource: "emby-last-played",
      QualifyingDate: "2025-01-01T00:00:00.000Z",
      SeriesInactiveDays: 400,
    }),
    {
      ItemId: "123",
      Title: "Example",
      Type: "Series",
      Year: 2024,
      Path: "/media/example",
      Arr: null,
      ArrId: null,
      HasPrimaryImage: true,
      Reason: "Last played 400 days ago",
      DateSource: "emby-last-played",
      QualifyingDate: "2025-01-01T00:00:00.000Z",
      SeriesInactiveDays: 400,
    },
  );
});

test("matches by Emby ID, Arr identity, or title and type", () => {
  assert.equal(
    isSameExclusion(
      { ItemId: "1", Type: "Movie", Title: "One" },
      { ItemId: "1", Type: "Movie", Title: "Different" },
    ),
    true,
  );
  assert.equal(
    isSameExclusion(
      { Arr: "Sonarr", ArrId: 4, Type: "Series", Title: "One" },
      { Arr: "Sonarr", ArrId: 4, Type: "Series", Title: "Different" },
    ),
    true,
  );
  assert.equal(
    isSameExclusion(
      { Type: "Movie", Title: "Example" },
      { Type: "Movie", Title: "example" },
    ),
    true,
  );
});

test("marks matching search results as already excluded", () => {
  const [item] = markExcluded(
    [{ ItemId: "10", Type: "Series", Title: "Show", Arr: "Sonarr", ArrId: 44 }],
    [{ ItemId: "saved-10", Type: "Series", Title: "Show", Arr: "Sonarr", ArrId: 44 }],
  );
  assert.equal(item.Excluded, true);
  assert.equal(item.ExclusionItemId, "saved-10");
});

test("reads provider IDs without depending on key casing", () => {
  assert.equal(getProviderId({ Tmdb: 123 }, "tmdb"), "123");
  assert.equal(getProviderId({ TVDB: "456" }, "tvdb"), "456");
});
