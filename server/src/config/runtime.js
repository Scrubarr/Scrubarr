import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDirectory, "..", "..", "..");

function resolveFromRoot(value, fallback) {
  const selected = value?.trim() || fallback;
  return path.isAbsolute(selected)
    ? path.normalize(selected)
    : path.resolve(projectRoot, selected);
}

function parsePort(value) {
  const port = Number.parseInt(value || "8098", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SCRUBARR_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function hostTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function createRuntimeConfig(environment = process.env) {
  const dataDirectory = resolveFromRoot(environment.SCRUBARR_DATA_DIR, "data");
  const backupDirectory = resolveFromRoot(
    environment.SCRUBARR_BACKUP_DIR,
    path.join(dataDirectory, "backups"),
  );

  return Object.freeze({
    projectRoot,
    host: environment.SCRUBARR_HOST?.trim() || "127.0.0.1",
    port: parsePort(environment.SCRUBARR_PORT),
    timezone: environment.SCRUBARR_TIMEZONE?.trim() || hostTimezone(),
    updateManifestUrl:
      environment.SCRUBARR_UPDATE_MANIFEST_URL?.trim() || "",
    movieQueueWritePath:
      environment.SCRUBARR_MOVIE_QUEUE_WRITE_PATH?.trim() || "",
    seriesQueueWritePath:
      environment.SCRUBARR_SERIES_QUEUE_WRITE_PATH?.trim() || "",
    dataDirectory,
    backupDirectory,
    logDirectory: resolveFromRoot(environment.SCRUBARR_LOG_DIR, "logs"),
    configFile: resolveFromRoot(
      environment.SCRUBARR_CONFIG_FILE,
      path.join(dataDirectory, "config.json"),
    ),
    pendingFile: path.join(dataDirectory, "ToDelete.json"),
    exclusionsFile: path.join(dataDirectory, "Exclusions.json"),
    inProgressFile: path.join(dataDirectory, "InProgress.json"),
    schedulerFile: path.join(dataDirectory, "Scheduler.json"),
    updateCheckFile: path.join(dataDirectory, "UpdateCheck.json"),
    librarySyncManifestDirectory: path.join(dataDirectory, "library-sync"),
    runLogFile: path.join(dataDirectory, "RunLog.json"),
    deletionStatsFile: path.join(dataDirectory, "DeletionStats.json"),
    appLogFile: path.join(resolveFromRoot(environment.SCRUBARR_LOG_DIR, "logs"), "Scrubarr.log"),
    deletedDirectory: path.join(dataDirectory, "deleted"),
    clientDistDirectory: path.join(projectRoot, "client", "dist"),
  });
}
