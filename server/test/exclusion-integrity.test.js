import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import {
  exclusionIntegrityReport,
  exclusionItemKey,
} from "../src/services/exclusion-integrity.js";

function configuredSettings() {
  const settings = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  settings.MediaServer.Locked = true;
  settings.Emby.ServerUrl = "http://example.local:8096";
  settings.Emby.ApiKey = "test-key";
  settings.Emby.SearchLibraries = ["Movies"];
  return settings;
}

function skipSourcePath() {
  return { checked: false, missing: false };
}

function skipArrRecord() {
  return { checked: false };
}

test("a single missing media-server signal requires review instead of removal", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Missing Movie",
    Type: "Movie",
    Year: 2020,
  };

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches: new Map() }),
    sourcePathChecker: skipSourcePath,
    arrRecordChecker: skipArrRecord,
  });

  assert.equal(report.ok, false);
  assert.equal(report.exclusionTotal, 1);
  assert.equal(report.status, "inconclusive");
  assert.equal(report.staleCount, 0);
  assert.equal(report.reviewCount, 1);
  assert.deepEqual(
    report.reviewItems[0].issues.map((issue) => issue.code),
    ["missing_media_server_item"],
  );
});

test("exclusion integrity treats failed media server checks as warnings", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Unknown Movie",
    Type: "Movie",
  };

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({
      checked: false,
      warning: "Emby could not be checked",
      matches: new Map(),
    }),
    sourcePathChecker: skipSourcePath,
    arrRecordChecker: skipArrRecord,
  });

  assert.equal(report.ok, false);
  assert.equal(report.status, "inconclusive");
  assert.equal(report.staleCount, 0);
  assert.deepEqual(report.warnings, ["Emby could not be checked"]);
});

test("a missing source path beside present media-server data requires review", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Deleted File Movie",
    Type: "Movie",
    Path: "/media/missing.mkv",
  };
  const matches = new Map([[exclusionItemKey(exclusion), exclusion]]);

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches }),
    sourcePathChecker: async () => ({ checked: true, missing: true }),
    arrRecordChecker: skipArrRecord,
  });

  assert.equal(report.ok, false);
  assert.equal(report.staleCount, 0);
  assert.equal(report.reviewCount, 1);
  assert.deepEqual(
    report.reviewItems[0].issues.map((issue) => issue.code),
    ["missing_source_file"],
  );
});

test("a missing Arr record beside present media-server data requires review", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Deleted Arr Movie",
    Type: "Movie",
    Arr: "Radarr",
    ArrId: 44,
  };
  const matches = new Map([[exclusionItemKey(exclusion), exclusion]]);

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches }),
    sourcePathChecker: skipSourcePath,
    arrRecordChecker: async () => ({
      checked: true,
      missing: true,
      issue: {
        code: "missing_arr_record",
        message: "Radarr no longer has a matching record for this exclusion.",
      },
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.staleCount, 0);
  assert.equal(report.reviewCount, 1);
  assert.deepEqual(
    report.reviewItems[0].issues.map((issue) => issue.code),
    ["missing_arr_record"],
  );
});

test("two independent missing signals confirm an exclusion can be removed", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Gone Everywhere",
    Type: "Movie",
    Arr: "Radarr",
    ArrId: 44,
    Path: "/media/missing.mkv",
  };

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches: new Map() }),
    sourcePathChecker: async () => ({ checked: true, missing: true }),
    arrRecordChecker: async () => ({
      checked: true,
      missing: true,
      issue: {
        code: "missing_arr_record",
        message: "Radarr no longer has a matching record for this exclusion.",
      },
    }),
  });

  assert.equal(report.status, "issues");
  assert.equal(report.staleCount, 1);
  assert.equal(report.reviewCount, 0);
  assert.deepEqual(
    report.items[0].issues.map((issue) => issue.code),
    ["missing_media_server_item", "missing_source_file", "missing_arr_record"],
  );
});

test("exclusion integrity passes when matching records still exist", async () => {
  const exclusion = {
    ItemId: "movie-1",
    Title: "Current Movie",
    Type: "Movie",
  };
  const matches = new Map([[exclusionItemKey(exclusion), exclusion]]);

  const report = await exclusionIntegrityReport({
    exclusions: [exclusion],
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches }),
    sourcePathChecker: skipSourcePath,
    arrRecordChecker: skipArrRecord,
  });

  assert.equal(report.ok, true);
  assert.equal(report.staleCount, 0);
  assert.equal(report.message, "Exclusions look good.");
});

test("exclusion integrity de-duplicates repeated connection warnings", async () => {
  const exclusions = [
    { ItemId: "movie-1", Title: "Movie One", Type: "Movie", ArrId: 1 },
    { ItemId: "movie-2", Title: "Movie Two", Type: "Movie", ArrId: 2 },
  ];
  const matches = new Map(
    exclusions.map((item) => [exclusionItemKey(item), item]),
  );

  const report = await exclusionIntegrityReport({
    exclusions,
    settings: configuredSettings(),
    mediaServerLookup: async () => ({ checked: true, matches }),
    sourcePathChecker: skipSourcePath,
    arrRecordChecker: async () => ({
      checked: false,
      warning: "Radarr could not be checked for exclusions",
    }),
  });

  assert.deepEqual(report.warnings, [
    "Radarr could not be checked for exclusions",
  ]);
});
