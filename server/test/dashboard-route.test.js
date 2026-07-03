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
