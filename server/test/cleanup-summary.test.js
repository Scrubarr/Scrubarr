import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDefaultSettings } from "../src/config/settings.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runtimeFor(directory) {
  return {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    appLogFile: path.join(directory, "logs", "Scrubarr.log"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
}

test("cleanup summary route describes draft cleanup settings", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-summary-"));
  const runtime = runtimeFor(directory);
  await fs.mkdir(runtime.logDirectory, { recursive: true });
  const settings = createDefaultSettings(runtime);
  settings.Mode.MovieType = "all";
  settings.Mode.SeriesType = "watched";
  settings.Mode.WatchedDays = 365;
  settings.Mode.UnwatchedDays = 365;
  settings.Mode.DaysOlderThan = 0;
  settings.CleanupFilters.Movies = {
    YearFrom: null,
    YearTo: 2020,
    IncludeGenres: ["Animation", "Family"],
    ExcludeGenres: [],
  };
  settings.CleanupFilters.Series = {
    YearFrom: null,
    YearTo: null,
    IncludeGenres: [],
    ExcludeGenres: [],
  };
  settings.Arrs.Radarr.Enabled = true;
  settings.Arrs.Sonarr.Enabled = true;

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/settings/cleanup-summary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
    );
    const summary = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(summary.movies, [
      "Eligible when media was last watched at least 1 year ago, or media was not watched and added at least 1 year ago.",
      "Continue Watching items are protected until they have been tracked there for 1 year.",
      "Only consider movies released in 2020 or earlier.",
      "Only consider movies matching one of these genres: Animation, Family.",
    ]);
    assert.deepEqual(summary.series, [
      "Eligible when media was last watched at least 1 year ago.",
      "Whole-series cleanup: Scrubarr checks episode playback to decide whether a show has been watched, then manages a qualifying show as one pending item.",
      "Continue Watching items are protected until they have been tracked there for 1 year.",
    ]);
    assert.deepEqual(summary.warnings, []);
  } finally {
    await close(server);
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
