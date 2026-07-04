import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultSettings,
  maskSettings,
  mergeSettings,
  mergeSubmittedSecrets,
  normalizeRuntimeManagedSettings,
  unsafeObjectKeyPath,
  validateSettings,
} from "../src/config/settings.js";
import { APP_VERSION } from "../src/config/version.js";
import { compareVersions, getCurrentVersion } from "../src/services/updates.js";

const runtime = { logDirectory: "C:\\unused" };

test("masks secrets while reporting whether each value is configured", () => {
  const settings = createDefaultSettings(runtime);
  settings.Emby.ApiKey = "emby-secret";
  settings.Jellyfin.ApiKey = "jellyfin-secret";
  settings.Arrs.Radarr.ApiKey = "radarr-secret";
  settings.Auth.PasswordHash = "stored-hash";

  const masked = maskSettings(settings);

  assert.equal(masked.Emby.ApiKey, "");
  assert.equal(masked.Emby.ApiKeyConfigured, true);
  assert.equal(masked.Jellyfin.ApiKey, "");
  assert.equal(masked.Jellyfin.ApiKeyConfigured, true);
  assert.equal(masked.Arrs.Radarr.ApiKey, "");
  assert.equal(masked.Arrs.Radarr.ApiKeyConfigured, true);
  assert.equal(masked.Auth.Password, "");
  assert.equal(masked.Auth.PasswordConfigured, true);
  assert.equal("PasswordHash" in masked.Auth, false);
  assert.equal("QueueWritePaths" in masked.Emby, false);
  assert.equal("QueueWritePaths" in masked.Jellyfin, false);
  assert.equal("LogDirectory" in masked.Logging, false);
  assert.equal("LogRetentionDays" in masked.Logging, false);
  assert.equal("Backups" in masked, false);
  assert.equal("Paths" in masked, false);
  assert.equal(JSON.stringify(masked).includes("emby-secret"), false);
  assert.equal(JSON.stringify(masked).includes("jellyfin-secret"), false);
  assert.equal(JSON.stringify(masked).includes("stored-hash"), false);
});

test("runtime managed settings are reset to defaults before saving", () => {
  const defaults = createDefaultSettings({
    movieQueueWritePath: "/queue/movies",
    seriesQueueWritePath: "/queue/series",
  });
  const settings = createDefaultSettings(runtime);
  settings.Logging.LogDirectory = "/user/logs";
  settings.Logging.LogRetentionDays = 7;
  settings.Paths.ExclusionsFile = "/user/exclusions.json";
  settings.Paths.TrackFile = "/user/pending.json";
  settings.Paths.DeletedTrackFolder = "/user/deleted";
  settings.Backups = {
    Scheduled: {
      Enabled: true,
      Frequency: "monthly",
      Time: "25:99",
      DaysOfWeek: [],
      Directory: "",
      IncludeSecrets: true,
      RetentionCount: 0,
    },
  };
  settings.Emby.QueueWritePaths.Movies = "/user/movie-queue";
  settings.Emby.QueueWritePaths.Series = "/user/series-queue";
  settings.Jellyfin.QueueWritePaths.Movies = "/user/jellyfin-movie-queue";
  settings.Jellyfin.QueueWritePaths.Series = "/user/jellyfin-series-queue";

  const normalized = normalizeRuntimeManagedSettings(settings, defaults);

  assert.equal(normalized.Logging.LogDirectory, defaults.Logging.LogDirectory);
  assert.equal(normalized.Logging.LogRetentionDays, defaults.Logging.LogRetentionDays);
  assert.deepEqual(normalized.Paths, defaults.Paths);
  assert.deepEqual(normalized.Backups, defaults.Backups);
  assert.deepEqual(normalized.Emby.QueueWritePaths, defaults.Emby.QueueWritePaths);
  assert.deepEqual(normalized.Jellyfin.QueueWritePaths, defaults.Jellyfin.QueueWritePaths);
  assert.deepEqual(validateSettings(normalized), []);
});

test("blank submitted secrets retain stored values without persisting mask flags", () => {
  const current = createDefaultSettings(runtime);
  current.Telegram.BotToken = "stored-token";
  const submitted = maskSettings(current);

  const merged = mergeSubmittedSecrets(current, submitted);

  assert.equal(merged.Telegram.BotToken, "stored-token");
  assert.equal("BotTokenConfigured" in merged.Telegram, false);
});

test("valid defaults preserve dry run and disable filesystem fallback", () => {
  const settings = createDefaultSettings(runtime);

  assert.deepEqual(validateSettings(settings), []);
  assert.equal(settings.CleanupRules.DryRun, true);
  assert.equal(settings.CleanupRules.FallbackFileDeletion, false);
  assert.deepEqual(settings.CleanupRules.DirectFileDeletionAllowedRoots, []);
  assert.equal(settings.CleanupRules.ProtectInProgress, true);
  assert.equal(settings.Mode.Type, "watched");
});

test("settings merge ignores unsafe object keys", () => {
  const defaults = createDefaultSettings(runtime);
  const unsafe = JSON.parse(
    '{"__proto__":{"polluted":true},"Emby":{"ApiKey":"safe","constructor":{"prototype":{"polluted":true}}}}',
  );

  const merged = mergeSettings(defaults, unsafe);

  assert.equal(merged.Emby.ApiKey, "safe");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(unsafeObjectKeyPath(unsafe), "__proto__");
});

test("inactive Jellyfin config does not block an Emby install", () => {
  const settings = createDefaultSettings(runtime);
  settings.MediaServer.Provider = "emby";
  settings.Jellyfin.ServerUrl = "";
  settings.Jellyfin.ApiKey = "";

  assert.deepEqual(validateSettings(settings), []);
});

test("active Jellyfin config is validated when selected", () => {
  const settings = createDefaultSettings(runtime);
  settings.MediaServer.Provider = "jellyfin";
  settings.Jellyfin.ServerUrl = "";

  const errors = validateSettings(settings);

  assert.equal(errors.some((error) => error.includes("Jellyfin.ServerUrl")), true);
});

test("rejects unsupported URLs and negative limits", () => {
  const settings = createDefaultSettings(runtime);
  settings.Emby.ServerUrl = "file:///secret";
  settings.Limits.MaxMoviesMarked = -1;

  const errors = validateSettings(settings);

  assert.equal(errors.some((error) => error.includes("http or https")), true);
  assert.equal(errors.some((error) => error.includes("MaxMoviesMarked")), true);
});

test("rejects notification days outside the deletion window", () => {
  const settings = createDefaultSettings(runtime);
  settings.DeletionSchedule.DaysUntilDeletion = 20;
  settings.DeletionSchedule.NotificationDays = [21, 10, 0];

  const errors = validateSettings(settings);

  assert.equal(
    errors.some((error) => error.includes("NotificationDays")),
    true,
  );
});

test("rejects invalid Telegram notification policy", () => {
  const settings = createDefaultSettings(runtime);
  settings.Telegram.NotificationPolicy = "custom";

  const errors = validateSettings(settings);

  assert.equal(
    errors.some((error) => error.includes("Telegram.NotificationPolicy")),
    true,
  );
});

test("rejects Arr pending tag names Radarr cannot accept", () => {
  const settings = createDefaultSettings(runtime);
  settings.Arrs.PendingTag.Enabled = true;
  settings.Arrs.PendingTag.Name = "Scrubarr Pending";

  const errors = validateSettings(settings);

  assert.equal(
    errors.some((error) => error.includes("Arrs.PendingTag.Name")),
    true,
  );
});

test("rejects invalid cleanup filter ranges and genre lists", () => {
  const settings = createDefaultSettings(runtime);
  settings.CleanupFilters.YearFrom = 2020;
  settings.CleanupFilters.YearTo = 1990;
  settings.CleanupFilters.IncludeGenres = ["Comedy"];
  settings.CleanupFilters.ExcludeGenres = [123];
  settings.CleanupFilters.Movies = {
    YearFrom: 2000,
    YearTo: 1990,
    IncludeGenres: ["Animation"],
    ExcludeGenres: [],
  };
  settings.Mode.MovieType = "bad-mode";

  const errors = validateSettings(settings);

  assert.equal(
    errors.some((error) => error.includes("YearFrom cannot be greater")),
    true,
  );
  assert.equal(
    errors.some((error) => error.includes("CleanupFilters.ExcludeGenres")),
    true,
  );
  assert.equal(
    errors.some((error) => error.includes("CleanupFilters.Movies.YearFrom")),
    true,
  );
  assert.equal(errors.some((error) => error.includes("Mode.MovieType")), true);
});

test("rejects invalid direct file deletion allowed roots", () => {
  const settings = createDefaultSettings(runtime);
  settings.CleanupRules.DirectFileDeletionAllowedRoots = ["/media", 123];

  const errors = validateSettings(settings);

  assert.equal(
    errors.some((error) => error.includes("DirectFileDeletionAllowedRoots")),
    true,
  );
});

test("basic auth requires username and password when enabled", () => {
  const settings = createDefaultSettings(runtime);
  settings.Auth.Enabled = true;

  const errors = validateSettings(settings);

  assert.equal(errors.some((error) => error.includes("Auth.Username")), true);
  assert.equal(errors.some((error) => error.includes("Auth.Password")), true);
});

test("validates managed backup directory after normalization", () => {
  const settings = createDefaultSettings(runtime);
  settings.Backups.Directory = "";

  const errors = validateSettings(settings);

  assert.equal(errors.some((error) => error.includes("Backups.Directory")), true);
});

test("validates automatic update check settings", () => {
  const settings = createDefaultSettings(runtime);
  settings.Updates.AutoCheckEnabled = "yes";

  const errors = validateSettings(settings);

  assert.equal(errors.some((error) => error.includes("Updates.AutoCheckEnabled")), true);
});

test("compares semantic release versions", () => {
  assert.equal(compareVersions("0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("v0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.0.9", "0.1.0"), -1);
  assert.match(getCurrentVersion(), /^\d+\.\d+\.\d+$/);
  assert.equal(getCurrentVersion(), APP_VERSION);
});
