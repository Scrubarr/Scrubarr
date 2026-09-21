import assert from "node:assert/strict";
import test from "node:test";
import { markDashboardSearchState } from "../src/routes/dashboard.js";

test("dashboard search marks pending, excluded, and available results", () => {
  const results = markDashboardSearchState(
    [
      {
        ItemId: "movie-1",
        Title: "Pending Movie",
        Type: "Movie",
      },
      {
        ItemId: "series-1",
        Title: "Excluded Series",
        Type: "Series",
        Arr: "Sonarr",
        ArrId: 101,
      },
      {
        ItemId: "movie-2",
        Title: "Available Movie",
        Type: "Movie",
      },
      {
        ItemId: "movie-3",
        Title: "Deleted History Movie",
        Type: "Movie",
      },
    ],
    {
      pending: [
        {
          ItemId: "movie-1",
          Title: "Pending Movie",
          Type: "Movie",
        },
        {
          ItemId: "movie-3",
          Title: "Deleted History Movie",
          Type: "Movie",
          Deleted: "2026-06-20",
        },
      ],
      exclusions: [
        {
          ItemId: "old-series-id",
          Title: "Excluded Series",
          Type: "Series",
          Arr: "Sonarr",
          ArrId: 101,
        },
      ],
    },
  );

  assert.deepEqual(
    results.map((item) => ({
      title: item.Title,
      pending: item.Pending,
      excluded: item.Excluded,
      exclusionItemId: item.ExclusionItemId,
      state: item.State,
    })),
    [
      {
        title: "Pending Movie",
        pending: true,
        excluded: false,
        exclusionItemId: undefined,
        state: "pending",
      },
      {
        title: "Excluded Series",
        pending: false,
        excluded: true,
        exclusionItemId: "old-series-id",
        state: "excluded",
      },
      {
        title: "Available Movie",
        pending: false,
        excluded: false,
        exclusionItemId: undefined,
        state: "available",
      },
      {
        title: "Deleted History Movie",
        pending: false,
        excluded: false,
        exclusionItemId: undefined,
        state: "available",
      },
    ],
  );
});

test("dashboard search collapses multiple media-server versions of one Arr title", () => {
  const results = markDashboardSearchState(
    [
      {
        ItemId: "movie-version-1",
        Title: "A Movie",
        Type: "Movie",
        Arr: "Radarr",
        ArrId: 42,
        ProviderIds: { Tmdb: "1234" },
        HasPrimaryImage: true,
      },
      {
        ItemId: "movie-version-2",
        Title: "A Movie",
        Type: "Movie",
        Arr: "Radarr",
        ArrId: 42,
        ProviderIds: { Tmdb: "1234" },
        HasPrimaryImage: true,
      },
      {
        ItemId: "different-movie",
        Title: "Another Movie",
        Type: "Movie",
        Arr: "Radarr",
        ArrId: 43,
        ProviderIds: { Tmdb: "5678" },
      },
    ],
    {
      pending: [],
      exclusions: [
        {
          ItemId: "movie-version-2",
          Title: "A Movie",
          Type: "Movie",
          Arr: "Radarr",
          ArrId: 42,
        },
      ],
    },
  );

  assert.equal(results.length, 2);
  assert.equal(results[0].ItemId, "movie-version-2");
  assert.equal(results[0].State, "excluded");
  assert.equal(results[1].ItemId, "different-movie");
});

test("dashboard search collapses duplicate provider IDs when no Arr match exists", () => {
  const results = markDashboardSearchState(
    [
      {
        ItemId: "series-version-1",
        Title: "A Series",
        Type: "Series",
        ProviderIds: { Tvdb: "9876" },
      },
      {
        ItemId: "series-version-2",
        Title: "A Series",
        Type: "Series",
        ProviderIds: { tvdb: "9876" },
      },
    ],
    { pending: [], exclusions: [] },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].ItemId, "series-version-1");
});
