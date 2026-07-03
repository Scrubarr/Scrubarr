import { isDeepStrictEqual } from "node:util";

export const DATA_SCHEMA_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function migrateSettings(settings = {}) {
  if (!isObject(settings)) return {};
  const migrated = structuredClone(settings);
  if (!isObject(migrated.MediaServer)) {
    const jellyfinConfigured = Boolean(migrated.Jellyfin?.ApiKey);
    const embyConfigured = Boolean(migrated.Emby?.ApiKey);
    if (!embyConfigured && !jellyfinConfigured) return migrated;
    migrated.MediaServer = {
      Provider: jellyfinConfigured && !embyConfigured ? "jellyfin" : "emby",
      Locked: Boolean(embyConfigured || jellyfinConfigured),
    };
  }
  return migrated;
}

export function migrateBackupData(data = {}) {
  const migrated = migratePersistedData(data);
  return {
    settings: migrated.settings,
    pending: migrated.pending,
    exclusions: migrated.exclusions,
    inProgress: migrated.inProgress,
    scheduler: migrated.scheduler,
    runLog: migrated.runLog,
    deletionStats: migrated.deletionStats,
  };
}

export function migratePersistedData(data = {}) {
  const source = isObject(data) ? data : {};
  return {
    settings: migrateSettings(source.settings),
    pending: asArray(source.pending),
    exclusions: asArray(source.exclusions),
    inProgress: asArray(source.inProgress),
    scheduler: isObject(source.scheduler) ? source.scheduler : {},
    runLog: asArray(source.runLog),
    deletionStats: isObject(source.deletionStats) ? source.deletionStats : {},
    updateCheck: isObject(source.updateCheck) ? source.updateCheck : {},
  };
}

export function migrateBackup(backup) {
  return {
    ...backup,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    data: migrateBackupData(backup?.data),
  };
}

const persistedStoreMigrations = [
  ["settings", "settingsStore"],
  ["pending", "pendingStore"],
  ["exclusions", "exclusionsStore"],
  ["inProgress", "inProgressStore"],
  ["scheduler", "schedulerStore"],
  ["runLog", "runLogStore"],
  ["deletionStats", "deletionStatsStore"],
  ["updateCheck", "updateCheckStore"],
];

export async function migratePersistedStores({ stores, appLog }) {
  const current = {};
  for (const [dataKey, storeKey] of persistedStoreMigrations) {
    current[dataKey] = await stores[storeKey].read();
  }

  const migrated = migratePersistedData(current);
  const changed = [];
  for (const [dataKey, storeKey] of persistedStoreMigrations) {
    if (!isDeepStrictEqual(current[dataKey], migrated[dataKey])) {
      await stores[storeKey].write(migrated[dataKey]);
      changed.push(dataKey);
    }
  }

  if (changed.length > 0) {
    await appLog?.info?.("Persisted data normalized", {
      dataSchemaVersion: DATA_SCHEMA_VERSION,
      collections: changed,
    });
  }

  return {
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    changed,
  };
}
