import path from "node:path";

const ARR_PENDING_TAG_NAME_PATTERN = /^[a-z0-9-]+$/;

export const SECRET_PATHS = [
  "Emby.ApiKey",
  "Jellyfin.ApiKey",
  "Arrs.Radarr.ApiKey",
  "Arrs.Sonarr.ApiKey",
  "Telegram.BotToken",
];

export function createDefaultSettings(runtime) {
  return {
    AppName: "Scrubarr",
    Logging: {
      LogDirectory: "./logs",
      LogRetentionDays: 90,
    },
    DebugMode: {
      Enabled: false,
    },
    Auth: {
      Enabled: false,
      Username: "",
      PasswordHash: "",
      Password: "",
    },
    Backups: {
      Directory: runtime?.backupDirectory ||
        (runtime?.dataDirectory ? path.join(runtime.dataDirectory, "backups") : "./data/backups"),
    },
    Updates: {
      AutoCheckEnabled: true,
    },
    Telegram: {
      Enabled: false,
      BotToken: "",
      ChatID: "",
      NotificationPolicy: "standard",
    },
    DeletionSchedule: {
      DaysUntilDeletion: 20,
      NotificationDays: [20, 10, 5, 1],
    },
    MediaServer: {
      Provider: "emby",
      Locked: false,
    },
    Mode: {
      Type: "watched",
      MovieType: null,
      SeriesType: null,
      WatchedDays: 90,
      UnwatchedDays: 180,
      DaysOlderThan: 365,
    },
    Limits: {
      MaxMoviesMarked: 40,
      MaxSeriesMarked: 3,
    },
    CleanupRules: {
      DryRun: true,
      FallbackFileDeletion: false,
      DirectFileDeletionAllowedRoots: [],
      ProtectInProgress: true,
    },
    CleanupFilters: {
      YearFrom: null,
      YearTo: null,
      IncludeGenres: [],
      ExcludeGenres: [],
      Movies: null,
      Series: null,
    },
    Arrs: {
      PendingTag: {
        Enabled: false,
        Name: "scrubarr-pending",
      },
      Radarr: {
        Enabled: false,
        Url: "http://localhost:7878",
        ApiKey: "",
      },
      Sonarr: {
        Enabled: false,
        Url: "http://localhost:8989",
        ApiKey: "",
      },
    },
    Emby: {
      ServerUrl: "http://localhost:8096",
      ApiKey: "",
      UserIds: [],
      SearchLibraries: ["Movies", "TV shows"],
      CreateDeletionLibraries: false,
      DeletionLibraries: {
        Movies: "Movies Leaving Soon",
        Series: "Shows Leaving Soon",
      },
      ToBeDeletedPaths: {
        Movies: "./data/leaving-soon/movies",
        Series: "./data/leaving-soon/series",
      },
      QueueWritePaths: {
        Movies: runtime?.movieQueueWritePath || "",
        Series: runtime?.seriesQueueWritePath || "",
      },
    },
    Jellyfin: {
      ServerUrl: "http://localhost:8096",
      ApiKey: "",
      UserIds: [],
      SearchLibraries: ["Movies", "TV shows"],
      CreateDeletionLibraries: false,
      DeletionLibraries: {
        Movies: "Movies Leaving Soon",
        Series: "Shows Leaving Soon",
      },
      ToBeDeletedPaths: {
        Movies: "./data/leaving-soon/movies",
        Series: "./data/leaving-soon/series",
      },
      QueueWritePaths: {
        Movies: runtime?.movieQueueWritePath || "",
        Series: runtime?.seriesQueueWritePath || "",
      },
    },
    Paths: {
      ExclusionsFile: "./data/Exclusions.json",
      TrackFile: "./data/ToDelete.json",
      DeletedTrackFolder: "./data/deleted",
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isUnsafeObjectKey(key) {
  return UNSAFE_OBJECT_KEYS.has(String(key));
}

export function unsafeObjectKeyPath(value, pathParts = []) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafePath = unsafeObjectKeyPath(value[index], [...pathParts, String(index)]);
      if (unsafePath) return unsafePath;
    }
    return "";
  }
  if (!isObject(value)) return "";

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    if (isUnsafeObjectKey(key)) return nextPath.join(".");
    const unsafePath = unsafeObjectKeyPath(child, nextPath);
    if (unsafePath) return unsafePath;
  }
  return "";
}

export function mergeSettings(base, incoming) {
  if (!isObject(incoming)) return structuredClone(base);

  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(incoming)) {
    if (isUnsafeObjectKey(key)) continue;
    if (isObject(value) && isObject(merged[key])) {
      merged[key] = mergeSettings(merged[key], value);
    } else {
      merged[key] = structuredClone(value);
    }
  }
  return merged;
}

function getAtPath(value, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((current, key) => (isUnsafeObjectKey(key) ? undefined : current?.[key]), value);
}

function setAtPath(value, dottedPath, nextValue) {
  const keys = dottedPath.split(".");
  if (keys.some(isUnsafeObjectKey)) return;
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current[key], value);
  parent[finalKey] = nextValue;
}

export function mergeSubmittedSecrets(current, submitted) {
  const merged = structuredClone(submitted);

  for (const secretPath of SECRET_PATHS) {
    const submittedValue = getAtPath(merged, secretPath);
    if (typeof submittedValue !== "string" || submittedValue.trim() === "") {
      setAtPath(merged, secretPath, getAtPath(current, secretPath) || "");
    }
    const configuredPath = `${secretPath}Configured`;
    const keys = configuredPath.split(".");
    const finalKey = keys.pop();
    const parent = keys.reduce((value, key) => value?.[key], merged);
    if (parent) delete parent[finalKey];
  }

  return merged;
}

export function maskSettings(settings) {
  const masked = structuredClone(settings);

  for (const secretPath of SECRET_PATHS) {
    const configured = Boolean(getAtPath(masked, secretPath));
    setAtPath(masked, secretPath, "");
    setAtPath(masked, `${secretPath}Configured`, configured);
  }

  if (masked.Auth) {
    masked.Auth.PasswordConfigured = Boolean(masked.Auth.PasswordHash);
    masked.Auth.Password = "";
    delete masked.Auth.PasswordHash;
  }

  if (masked.Emby) {
    delete masked.Emby.QueueWritePaths;
  }
  if (masked.Jellyfin) {
    delete masked.Jellyfin.QueueWritePaths;
  }
  delete masked.SeriesHandling;
  if (masked.Logging) {
    delete masked.Logging.LogDirectory;
    delete masked.Logging.LogRetentionDays;
  }
  delete masked.Backups;
  delete masked.Paths;

  return masked;
}

export function normalizeRuntimeManagedSettings(settings, defaults) {
  const normalized = structuredClone(settings);
  normalized.Logging = {
    ...normalized.Logging,
    LogDirectory: defaults.Logging.LogDirectory,
    LogRetentionDays: defaults.Logging.LogRetentionDays,
  };
  normalized.Paths = structuredClone(defaults.Paths);
  normalized.Backups = structuredClone(defaults.Backups);
  delete normalized.SeriesHandling;
  normalized.Emby = {
    ...normalized.Emby,
    QueueWritePaths: structuredClone(defaults.Emby.QueueWritePaths),
  };
  normalized.Jellyfin = {
    ...normalized.Jellyfin,
    QueueWritePaths: structuredClone(defaults.Jellyfin.QueueWritePaths),
  };
  return normalized;
}

function requireObject(value, name, errors) {
  if (!isObject(value)) errors.push(`${name} must be an object`);
}

function requireInteger(value, name, errors, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    errors.push(`${name} must be an integer of at least ${minimum}`);
  }
}

function requireBoolean(value, name, errors) {
  if (typeof value !== "boolean") errors.push(`${name} must be true or false`);
}

function requireString(value, name, errors, { allowEmpty = true } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    errors.push(`${name} must be a string${allowEmpty ? "" : " and cannot be empty"}`);
  }
}

function requireUrl(value, name, errors) {
  requireString(value, name, errors, { allowEmpty: false });
  if (typeof value !== "string" || value.trim() === "") return;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${name} must use http or https`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function validateModeType(value, name, errors, { allowNull = false } = {}) {
  if (allowNull && value === null) return;
  if (!["all", "watched", "unwatched"].includes(value)) {
    errors.push(`${name} must be all, watched, or unwatched`);
  }
}

function validateCleanupFilterGroup(filters, name, errors, { allowNull = false } = {}) {
  if (allowNull && filters === null) return;
  requireObject(filters, name, errors);
  if (!isObject(filters)) return;

  for (const [field, value] of [
    ["YearFrom", filters.YearFrom],
    ["YearTo", filters.YearTo],
  ]) {
    if (value !== null && value !== "" && (!Number.isInteger(value) || value < 1)) {
      errors.push(`${name}.${field} must be blank or a positive year`);
    }
  }
  if (
    Number.isInteger(filters.YearFrom) &&
    Number.isInteger(filters.YearTo) &&
    filters.YearFrom > filters.YearTo
  ) {
    errors.push(`${name}.YearFrom cannot be greater than ${name}.YearTo`);
  }

  for (const [field, value] of [
    ["IncludeGenres", filters.IncludeGenres],
    ["ExcludeGenres", filters.ExcludeGenres],
  ]) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      errors.push(`${name}.${field} must be a list of strings`);
    }
  }
}

export function validateSettings(settings) {
  const errors = [];

  for (const section of [
    "Logging",
    "DebugMode",
    "Auth",
    "Backups",
    "Updates",
    "Telegram",
    "DeletionSchedule",
    "MediaServer",
    "Mode",
    "Limits",
    "CleanupRules",
    "CleanupFilters",
    "Arrs",
    "Emby",
    "Jellyfin",
    "Paths",
  ]) {
    requireObject(settings[section], section, errors);
  }

  if (errors.length > 0) return errors;

  requireInteger(settings.Logging.LogRetentionDays, "Logging.LogRetentionDays", errors, 1);
  requireBoolean(settings.DebugMode.Enabled, "DebugMode.Enabled", errors);
  requireBoolean(settings.Auth.Enabled, "Auth.Enabled", errors);
  requireString(settings.Auth.Username, "Auth.Username", errors);
  requireString(settings.Auth.PasswordHash, "Auth.PasswordHash", errors);
  requireString(settings.Auth.Password, "Auth.Password", errors);
  if (settings.Auth.Enabled) {
    if (!settings.Auth.Username?.trim()) {
      errors.push("Auth.Username is required when basic auth is enabled");
    }
    if (!settings.Auth.PasswordHash && !settings.Auth.Password) {
      errors.push("Auth.Password is required when basic auth is enabled");
    }
  }
  requireString(settings.Backups.Directory, "Backups.Directory", errors, {
    allowEmpty: false,
  });
  requireBoolean(
    settings.Updates.AutoCheckEnabled,
    "Updates.AutoCheckEnabled",
    errors,
  );
  requireBoolean(settings.Telegram.Enabled, "Telegram.Enabled", errors);
  if (!["full", "standard", "lifecycle"].includes(settings.Telegram.NotificationPolicy)) {
    errors.push("Telegram.NotificationPolicy must be full, standard, or lifecycle");
  }
  requireInteger(
    settings.DeletionSchedule.DaysUntilDeletion,
    "DeletionSchedule.DaysUntilDeletion",
    errors,
    1,
  );

  if (!Array.isArray(settings.DeletionSchedule.NotificationDays)) {
    errors.push("DeletionSchedule.NotificationDays must be a list of integers");
  } else {
    const invalidNotificationDay = settings.DeletionSchedule.NotificationDays.some(
      (day) =>
        !Number.isInteger(day) ||
        day < 1 ||
        day > settings.DeletionSchedule.DaysUntilDeletion,
    );
    if (invalidNotificationDay) {
      errors.push(
        "DeletionSchedule.NotificationDays must be between 1 and DaysUntilDeletion",
      );
    }
  }

  if (!["emby", "jellyfin"].includes(settings.MediaServer.Provider)) {
    errors.push("MediaServer.Provider must be emby or jellyfin");
  }
  requireBoolean(settings.MediaServer.Locked, "MediaServer.Locked", errors);

  validateModeType(settings.Mode.Type, "Mode.Type", errors);
  validateModeType(settings.Mode.MovieType ?? null, "Mode.MovieType", errors, {
    allowNull: true,
  });
  validateModeType(settings.Mode.SeriesType ?? null, "Mode.SeriesType", errors, {
    allowNull: true,
  });
  requireInteger(settings.Mode.WatchedDays, "Mode.WatchedDays", errors);
  requireInteger(settings.Mode.UnwatchedDays, "Mode.UnwatchedDays", errors);
  requireInteger(settings.Mode.DaysOlderThan, "Mode.DaysOlderThan", errors);

  requireInteger(settings.Limits.MaxMoviesMarked, "Limits.MaxMoviesMarked", errors);
  requireInteger(settings.Limits.MaxSeriesMarked, "Limits.MaxSeriesMarked", errors);
  requireBoolean(settings.CleanupRules.DryRun, "CleanupRules.DryRun", errors);
  requireBoolean(
    settings.CleanupRules.FallbackFileDeletion,
    "CleanupRules.FallbackFileDeletion",
    errors,
  );
  if (
    !Array.isArray(settings.CleanupRules.DirectFileDeletionAllowedRoots) ||
    settings.CleanupRules.DirectFileDeletionAllowedRoots.some((item) => typeof item !== "string")
  ) {
    errors.push("CleanupRules.DirectFileDeletionAllowedRoots must be a list of strings");
  }
  requireBoolean(
    settings.CleanupRules.ProtectInProgress,
    "CleanupRules.ProtectInProgress",
    errors,
  );

  validateCleanupFilterGroup(settings.CleanupFilters, "CleanupFilters", errors);
  validateCleanupFilterGroup(
    settings.CleanupFilters.Movies ?? null,
    "CleanupFilters.Movies",
    errors,
    { allowNull: true },
  );
  validateCleanupFilterGroup(
    settings.CleanupFilters.Series ?? null,
    "CleanupFilters.Series",
    errors,
    { allowNull: true },
  );

  requireObject(settings.Arrs.PendingTag, "Arrs.PendingTag", errors);
  if (isObject(settings.Arrs.PendingTag)) {
    requireBoolean(settings.Arrs.PendingTag.Enabled, "Arrs.PendingTag.Enabled", errors);
    requireString(settings.Arrs.PendingTag.Name, "Arrs.PendingTag.Name", errors, {
      allowEmpty: false,
    });
    const pendingTagName = String(settings.Arrs.PendingTag.Name || "").trim();
    if (
      settings.Arrs.PendingTag.Enabled === true &&
      pendingTagName &&
      !ARR_PENDING_TAG_NAME_PATTERN.test(pendingTagName)
    ) {
      errors.push(
        "Arrs.PendingTag.Name: Radarr/Sonarr tag name must use lowercase letters, numbers, and hyphens only, for example: scrubarr-pending",
      );
    }
  }

  for (const service of ["Radarr", "Sonarr"]) {
    const config = settings.Arrs?.[service];
    requireObject(config, `Arrs.${service}`, errors);
    if (!isObject(config)) continue;
    requireBoolean(config.Enabled, `Arrs.${service}.Enabled`, errors);
    requireUrl(config.Url, `Arrs.${service}.Url`, errors);
    requireString(config.ApiKey, `Arrs.${service}.ApiKey`, errors);
  }

  const activeMediaServer =
    settings.MediaServer.Provider === "jellyfin" ? "Jellyfin" : "Emby";
  const activeMediaServerConfig = settings[activeMediaServer];
  const validateActiveMediaServer =
    settings.MediaServer.Locked === true ||
    settings.MediaServer.Provider !== "emby" ||
    String(activeMediaServerConfig?.ServerUrl || "").trim() ||
    String(activeMediaServerConfig?.ApiKey || "").trim();

  if (validateActiveMediaServer) {
    requireUrl(
      activeMediaServerConfig.ServerUrl,
      `${activeMediaServer}.ServerUrl`,
      errors,
    );
    requireString(activeMediaServerConfig.ApiKey, `${activeMediaServer}.ApiKey`, errors);
    requireBoolean(
      activeMediaServerConfig.CreateDeletionLibraries,
      `${activeMediaServer}.CreateDeletionLibraries`,
      errors,
    );
  }

  for (const mediaServer of ["Emby", "Jellyfin"]) {
    const config = settings[mediaServer];
    for (const [name, value] of [
      [`${mediaServer}.SearchLibraries`, config.SearchLibraries],
      [`${mediaServer}.UserIds`, config.UserIds],
    ]) {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`${name} must be a list of strings`);
      }
    }
    for (const [name, value] of [
      [`${mediaServer}.DeletionLibraries.Movies`, config.DeletionLibraries?.Movies],
      [`${mediaServer}.DeletionLibraries.Series`, config.DeletionLibraries?.Series],
      [`${mediaServer}.ToBeDeletedPaths.Movies`, config.ToBeDeletedPaths?.Movies],
      [`${mediaServer}.ToBeDeletedPaths.Series`, config.ToBeDeletedPaths?.Series],
      [`${mediaServer}.QueueWritePaths.Movies`, config.QueueWritePaths?.Movies],
      [`${mediaServer}.QueueWritePaths.Series`, config.QueueWritePaths?.Series],
    ]) {
      requireString(value, name, errors);
    }
  }

  for (const [name, value] of [
    ["Telegram.BotToken", settings.Telegram.BotToken],
    ["Telegram.ChatID", settings.Telegram.ChatID],
    ["Logging.LogDirectory", settings.Logging.LogDirectory],
    ["Paths.ExclusionsFile", settings.Paths.ExclusionsFile],
    ["Paths.TrackFile", settings.Paths.TrackFile],
    ["Paths.DeletedTrackFolder", settings.Paths.DeletedTrackFolder],
  ]) {
    requireString(value, name, errors);
  }

  return errors;
}
