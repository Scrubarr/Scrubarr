import fs from "node:fs/promises";
import path from "node:path";
import { maskSettings, mergeSettings } from "../config/settings.js";
import { DATA_SCHEMA_VERSION } from "./data-migrations.js";

export const BACKUP_FORMAT = "scrubarr-backup";
export const BACKUP_VERSION = 1;
const BACKUP_FILE_PREFIX = "scrubarr-backup-";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function backupFileName(date = new Date(), label = "") {
  const suffix = label ? `${label.replaceAll(/[^a-z0-9-]/gi, "-")}-` : "";
  return `${BACKUP_FILE_PREFIX}${suffix}${date.toISOString().replaceAll(":", "-").slice(0, 19)}.json`;
}

export async function createBackup({ stores, defaults, includeSecrets, now = new Date() }) {
  const settings = mergeSettings(defaults, await stores.settingsStore.read());
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    includesSecrets: includeSecrets === true,
    data: {
      settings: includeSecrets ? settings : maskSettings(settings),
      pending: asArray(await stores.pendingStore.read()),
      exclusions: asArray(await stores.exclusionsStore.read()),
      inProgress: asArray(await stores.inProgressStore.read()),
      scheduler: await stores.schedulerStore.read(),
      runLog: asArray(await stores.runLogStore.read()),
      deletionStats: await stores.deletionStatsStore.read(),
    },
  };
}

export async function writeBackupFile({ backup, directory, now = new Date(), label = "" }) {
  const resolvedDirectory = path.resolve(directory);
  await fs.mkdir(resolvedDirectory, { recursive: true });
  const fileName = backupFileName(now, label);
  const filePath = path.join(resolvedDirectory, fileName);
  await fs.writeFile(filePath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  return {
    fileName,
    filePath,
    directory: resolvedDirectory,
  };
}
