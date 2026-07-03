import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { previewScan } from "../src/services/scan-engine.js";

const now = new Date("2026-06-07T12:00:00.000Z");
const runtime = { logDirectory: "./logs" };

function settings() {
  return createDefaultSettings(runtime);
}

function item(overrides = {}) {
  return {
    ItemId: "1",
    Title: "Example",
    Type: "Movie",
    UserData: { PlayCount: 0, LastPlayedDate: null },
    DateCreated: "2024-01-01T00:00:00.000Z",
    ArrDateAdded: "2024-01-01T00:00:00.000Z",
    Genres: [],
    ...overrides,
  };
}

test("DaysOlderThan is a minimum Arr-age gate, not a playback override", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.Mode.DaysOlderThan = 365;
  const result = previewScan({
    items: [
      item({
        UserData: {
          PlayCount: 1,
          LastPlayedDate: "2026-05-01T00:00:00.000Z",
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["age-rule-not-met"], 1);
});

test("DaysOlderThan gate rejects items without an Arr date", () => {
  const config = settings();
  const result = previewScan({
    items: [item({ ArrDateAdded: null })],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["missing-arr-date"], 1);
});

test("DaysOlderThan still allows items that pass watched or unwatched rules", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.Mode.DaysOlderThan = 365;
  const result = previewScan({
    items: [item()],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].DateSource, "arr");
  assert.match(result.candidates[0].Reason, /minimum/);
  assert.deepEqual(result.candidates[0].QualificationReasons, [
    "Unwatched and added 888 days ago (180+ days)",
    "Arr added 888 days ago (365+ day minimum)",
  ]);
});

test("watched mode uses Emby LastPlayedDate", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "watched";
  config.Mode.WatchedDays = 90;
  const result = previewScan({
    items: [
      item({
        UserData: {
          PlayCount: 1,
          LastPlayedDate: "2025-01-01T00:00:00.000Z",
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates[0].DateSource, "emby-last-played");
});

test("watched mode does not qualify media only because Arr added date is old", () => {
  const config = settings();
  config.Mode.Type = "watched";
  config.Mode.DaysOlderThan = 365;
  const result = previewScan({
    items: [
      item({
        UserData: { PlayCount: 0, LastPlayedDate: null },
        ArrDateAdded: "2020-01-01T00:00:00.000Z",
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["watched-rule-not-met"], 1);
});

test("in-progress media is skipped before age rules can mark it", () => {
  const config = settings();
  config.Mode.Type = "all";
  const result = previewScan({
    items: [
      item({
        InProgress: true,
        ArrDateAdded: "2020-01-01T00:00:00.000Z",
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["in-progress"], 1);
});

test("in-progress media can qualify after its tracked age passes cleanup age", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.Mode.UnwatchedDays = 180;
  const result = previewScan({
    items: [
      item({
        InProgress: true,
        InProgressSince: "2025-01-01T00:00:00.000Z",
        ArrDateAdded: "2020-01-01T00:00:00.000Z",
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.summary.skipped["in-progress"], undefined);
});

test("in-progress media can be allowed when protection is disabled", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.CleanupRules.ProtectInProgress = false;
  const result = previewScan({
    items: [
      item({
        InProgress: true,
        ArrDateAdded: "2020-01-01T00:00:00.000Z",
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].DateSource, "arr");
});

test("unwatched mode falls back from Arr to Emby created date", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "unwatched";
  config.Mode.UnwatchedDays = 180;
  const result = previewScan({
    items: [item({ ArrDateAdded: null })],
    settings: config,
    now,
  });

  assert.equal(result.candidates[0].DateSource, "emby-created");
});

test("series without episode activity is skipped as unknown watch history", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "watched";
  config.Mode.WatchedDays = 10;
  const result = previewScan({
    items: [
      item({
        Type: "Series",
        UserData: {
          PlayCount: 1,
          LastPlayedDate: "2026-05-01T00:00:00.000Z",
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["watch-history-unknown"], 1);
});

test("media with unknown watch history is skipped for safety", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "all";
  const result = previewScan({
    items: [
      item({
        WatchHistoryKnown: false,
        UserData: { PlayCount: 0, LastPlayedDate: null },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["watch-history-unknown"], 1);
});

test("series cleanup uses latest episode playback for series decisions", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "watched";
  config.Mode.WatchedDays = 90;
  const result = previewScan({
    items: [
      item({
        Type: "Series",
        UserData: { PlayCount: 0, LastPlayedDate: null },
        EpisodeActivity: {
          EpisodeCount: 20,
          PlayedEpisodeCount: 1,
          PlayCount: 1,
          LastPlayedDate: "2025-01-01T00:00:00.000Z",
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].DateSource, "emby-episode-last-played");
  assert.match(result.candidates[0].Reason, /Latest episode watched/);
});

test("series cleanup protects series with recent episode playback", () => {
  const config = settings();
  config.Mode.DaysOlderThan = 0;
  config.Mode.Type = "watched";
  config.Mode.WatchedDays = 10;
  const result = previewScan({
    items: [
      item({
        Type: "Series",
        UserData: {
          PlayCount: 1,
          LastPlayedDate: "2024-01-01T00:00:00.000Z",
        },
        EpisodeActivity: {
          EpisodeCount: 20,
          PlayedEpisodeCount: 1,
          PlayCount: 1,
          LastPlayedDate: "2026-06-01T00:00:00.000Z",
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.summary.skipped["watched-rule-not-met"], 1);
});

test("exclusions, pending items, and configured caps are respected", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.Limits.MaxMoviesMarked = 2;
  const items = [
    item({ ItemId: "1", Title: "Excluded" }),
    item({ ItemId: "2", Title: "Pending" }),
    item({ ItemId: "3", Title: "Candidate A" }),
    item({ ItemId: "4", Title: "Candidate B" }),
  ];
  const result = previewScan({
    items,
    settings: config,
    exclusions: [{ ItemId: "1", Type: "Movie", Title: "Excluded" }],
    pending: [{ ItemId: "2", Type: "Movie", Title: "Pending" }],
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Candidate A"],
  );
  assert.equal(result.summary.skipped.excluded, 1);
  assert.equal(result.summary.skipped["already-pending"], 1);
  assert.equal(result.summary.skipped["movie-limit"], 1);
});

test("cleanup filters can limit candidates to a release year range", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.CleanupFilters.YearFrom = 1990;
  config.CleanupFilters.YearTo = 2000;

  const result = previewScan({
    items: [
      item({ ItemId: "1", Title: "Too Old", Year: 1989 }),
      item({ ItemId: "2", Title: "Just Right", Year: 1995 }),
      item({ ItemId: "3", Title: "Too New", Year: 2001 }),
    ],
    settings: config,
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Just Right"],
  );
  assert.deepEqual(result.candidates[0].QualificationReasons, [
    "Unwatched and added 888 days ago (180+ days)",
    "Arr added 888 days ago (365+ day minimum)",
    "Release year 1995 is between 1990 and 2000",
  ]);
  assert.equal(result.summary.skipped["year-before-filter"], 1);
  assert.equal(result.summary.skipped["year-after-filter"], 1);
});

test("cleanup filters can include and exclude genres", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.CleanupFilters.IncludeGenres = ["Comedy"];
  config.CleanupFilters.ExcludeGenres = ["Horror"];

  const result = previewScan({
    items: [
      item({ ItemId: "1", Title: "Comedy", Genres: ["Comedy"] }),
      item({ ItemId: "2", Title: "Drama", Genres: ["Drama"] }),
      item({ ItemId: "3", Title: "Scary Comedy", Genres: ["Comedy", "Horror"] }),
    ],
    settings: config,
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Comedy"],
  );
  assert.deepEqual(result.candidates[0].QualificationReasons, [
    "Unwatched and added 888 days ago (180+ days)",
    "Arr added 888 days ago (365+ day minimum)",
    "Matched include genre: Comedy",
  ]);
  assert.equal(result.summary.skipped["genre-not-included"], 1);
  assert.equal(result.summary.skipped["genre-excluded"], 1);
});

test("movie and series modes can be configured separately", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.Mode.MovieType = "watched";
  config.Mode.SeriesType = "unwatched";
  config.Mode.DaysOlderThan = 0;

  const result = previewScan({
    items: [
      item({
        ItemId: "1",
        Title: "Unwatched Movie",
        Type: "Movie",
        UserData: { PlayCount: 0, LastPlayedDate: null },
      }),
      item({
        ItemId: "2",
        Title: "Unwatched Series",
        Type: "Series",
        UserData: { PlayCount: 0, LastPlayedDate: null },
        EpisodeActivity: {
          EpisodeCount: 10,
          PlayedEpisodeCount: 0,
          PlayCount: 0,
          LastPlayedDate: null,
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Unwatched Series"],
  );
  assert.equal(result.summary.skipped["watched-rule-not-met"], 1);
});

test("scoped movie genre filters do not filter series", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.CleanupFilters.Movies = {
    YearFrom: null,
    YearTo: null,
    IncludeGenres: ["Animation"],
    ExcludeGenres: [],
  };
  config.CleanupFilters.Series = {
    YearFrom: null,
    YearTo: null,
    IncludeGenres: [],
    ExcludeGenres: [],
  };

  const result = previewScan({
    items: [
      item({
        ItemId: "1",
        Title: "Animated Movie",
        Type: "Movie",
        Genres: ["Animation"],
      }),
      item({
        ItemId: "2",
        Title: "Drama Movie",
        Type: "Movie",
        Genres: ["Drama"],
      }),
      item({
        ItemId: "3",
        Title: "Drama Series",
        Type: "Series",
        Genres: ["Drama"],
        EpisodeActivity: {
          EpisodeCount: 10,
          PlayedEpisodeCount: 0,
          PlayCount: 0,
          LastPlayedDate: null,
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Animated Movie", "Drama Series"],
  );
  assert.equal(result.summary.skipped["genre-not-included"], 1);
});

test("legacy global genre filters apply to movies but not series", () => {
  const config = settings();
  config.Mode.Type = "all";
  config.CleanupFilters.IncludeGenres = ["Animation"];
  config.CleanupFilters.ExcludeGenres = [];

  const result = previewScan({
    items: [
      item({
        ItemId: "1",
        Title: "Drama Movie",
        Type: "Movie",
        Genres: ["Drama"],
      }),
      item({
        ItemId: "2",
        Title: "Drama Series",
        Type: "Series",
        Genres: ["Drama"],
        EpisodeActivity: {
          EpisodeCount: 10,
          PlayedEpisodeCount: 0,
          PlayCount: 0,
          LastPlayedDate: null,
        },
      }),
    ],
    settings: config,
    now,
  });

  assert.deepEqual(
    result.candidates.map((candidate) => candidate.Title),
    ["Drama Series"],
  );
  assert.equal(result.summary.skipped["genre-not-included"], 1);
});

test("preview is read-only and does not mutate supplied arrays", () => {
  const config = settings();
  const items = [item()];
  const pending = [];
  const exclusions = [];
  const snapshot = JSON.stringify({ items, pending, exclusions });

  const result = previewScan({ items, settings: config, pending, exclusions, now });

  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify({ items, pending, exclusions }), snapshot);
});
