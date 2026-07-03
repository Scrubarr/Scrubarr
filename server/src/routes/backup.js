import { Router } from "express";
import {
  maskSettings,
  mergeSettings,
  normalizeRuntimeManagedSettings,
  SECRET_PATHS,
  validateSettings,
} from "../config/settings.js";
import { migrateBackup } from "../services/data-migrations.js";
import { rebuildPendingFromDeletionQueue } from "../services/deletion-library-sync.js";
import { activePendingItems } from "../services/pending-state.js";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackup,
  writeBackupFile,
} from "../services/backup-export.js";
import { isPendingMutationBusy } from "../services/pending-mutation-coordinator.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function deleteAtPath(value, dottedPath) {
  const keys = dottedPath.split(".");
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current?.[key], value);
  if (parent && Object.hasOwn(parent, finalKey)) delete parent[finalKey];
}

function removeMaskedSecrets(settings) {
  const cleaned = structuredClone(settings || {});
  for (const secretPath of SECRET_PATHS) {
    deleteAtPath(cleaned, secretPath);
    deleteAtPath(cleaned, `${secretPath}Configured`);
  }
  deleteAtPath(cleaned, "Auth.Password");
  deleteAtPath(cleaned, "Auth.PasswordConfigured");
  deleteAtPath(cleaned, "Auth.PasswordHash");
  return cleaned;
}

function validateBackupShape(backup) {
  return (
    backup?.format === BACKUP_FORMAT &&
    backup.version === BACKUP_VERSION &&
    backup.data &&
    typeof backup.data === "object"
  );
}

function normalizedBackup(backup) {
  return validateBackupShape(backup) ? migrateBackup(backup) : null;
}

function backupImportSummary(backup) {
  const pendingRecords = asArray(backup.data.pending);
  const activePending = activePendingItems(pendingRecords);
  return {
    format: backup.format,
    version: backup.version,
    exportedAt: backup.exportedAt || null,
    includesSecrets: backup.includesSecrets === true,
    counts: {
      pending: activePending.length,
      deletedHistory: pendingRecords.length - activePending.length,
      pendingRecords: pendingRecords.length,
      exclusions: asArray(backup.data.exclusions).length,
      inProgress: asArray(backup.data.inProgress).length,
      runLog: asArray(backup.data.runLog).length,
      deletionStats: Number(backup.data.deletionStats?.allTime?.total || 0),
    },
    schedulerEnabled: backup.data.scheduler?.config?.enabled === true,
    hasAuthSettings: Boolean(
      backup.data.settings?.Auth?.Enabled ||
        backup.data.settings?.Auth?.Username ||
        backup.data.settings?.Auth?.Password ||
        backup.data.settings?.Auth?.PasswordHash,
    ),
    hasTelegramSettings: Boolean(
      backup.data.settings?.Telegram?.Enabled ||
        backup.data.settings?.Telegram?.BotToken ||
        backup.data.settings?.Telegram?.ChatID,
    ),
  };
}

const BACKUP_COLLECTION_LIMITS = {
  pending: 5000,
  exclusions: 10000,
  inProgress: 10000,
  runLog: 10000,
};

function backupDataValidationErrors(backup) {
  const errors = [];
  const data = backup?.data || {};
  for (const [key, limit] of Object.entries(BACKUP_COLLECTION_LIMITS)) {
    const collection = asArray(data[key]);
    if (collection.length > limit) {
      errors.push({
        field: key,
        message: `${key} contains ${collection.length} item(s), which is over the restore limit of ${limit}.`,
      });
    }
  }
  return errors;
}

function invalidBackupResponse(response) {
  response.status(400).json({
    error: "invalid_backup",
    message: "This does not look like a Scrubarr backup file.",
  });
}

function invalidBackupDataResponse(response, details) {
  response.status(400).json({
    error: "invalid_backup_data",
    message: "This backup is too large or contains unsupported data.",
    details,
  });
}

const RESTORE_SECTIONS = new Set([
  "settings",
  "exclusions",
  "scheduler",
  "activity",
  "history",
  "pending",
]);
const SAFE_FULL_RESTORE_SECTIONS = [
  "settings",
  "exclusions",
  "scheduler",
  "activity",
  "history",
];

function legacyModeSections(mode) {
  if (mode === "full") return [...SAFE_FULL_RESTORE_SECTIONS];
  if (mode === "settings") return ["settings"];
  if (mode === "exclusions") return ["exclusions"];
  if (mode === "pending") return ["pending"];
  return null;
}

function parseImportRequest(body) {
  if (validateBackupShape(body)) {
    return {
      backup: body,
      mode: "full",
      sections: [...SAFE_FULL_RESTORE_SECTIONS],
      validMode: true,
    };
  }
  const rawSections = Array.isArray(body?.sections) ? body.sections.map(String) : null;
  const mode = body?.mode || (rawSections ? "custom" : "full");
  const sections = rawSections || legacyModeSections(mode) || [];
  return {
    backup: body?.backup,
    mode,
    sections,
    validMode:
      sections.length > 0 &&
      sections.every((section) => RESTORE_SECTIONS.has(section)),
  };
}

function shouldRestore(sections, section) {
  return sections.includes(section);
}

const passThroughMutations = {
  run: async (_operation, callback) => callback(),
};

function createImportWriter() {
  const snapshots = [];
  const snapshotKeys = new Set();

  return {
    async write(key, store, value) {
      if (!snapshotKeys.has(key)) {
        snapshots.push({ key, store, value: await store.read() });
        snapshotKeys.add(key);
      }
      await store.write(value);
    },
    async rollback(appLog) {
      for (const snapshot of [...snapshots].reverse()) {
        try {
          await snapshot.store.write(snapshot.value);
        } catch (error) {
          await appLog.warn("Backup import rollback failed", {
            store: snapshot.key,
            message: error.message || "Unable to restore previous data",
          });
        }
      }
    },
  };
}

export function createBackupRouter({
  stores,
  defaults,
  appLog,
  librarySyncManifestDirectory,
  timezone = "UTC",
  pendingMutations = passThroughMutations,
}) {
  const router = Router();

  router.get("/export", async (request, response, next) => {
    try {
      const includeSecrets = request.query.includeSecrets === "true";
      const backup = await createBackup({ stores, defaults, includeSecrets });

      await appLog.debug("Backup exported", {
        includeSecrets,
        pendingCount: backup.data.pending.length,
        exclusionCount: backup.data.exclusions.length,
      });
      response.set(
        "Content-Disposition",
        `attachment; filename="scrubarr-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      response.json(backup);
    } catch (error) {
      next(error);
    }
  });

  router.post("/pre-update", async (_request, response, next) => {
    try {
      const currentSettings = mergeSettings(
        defaults,
        await stores.settingsStore.read(),
      );
      const backup = await createBackup({
        stores,
        defaults,
        includeSecrets: true,
      });
      const written = await writeBackupFile({
        backup,
        directory: currentSettings.Backups?.Directory || defaults.Backups.Directory,
        label: "pre-update",
      });

      await appLog.info("Pre-update backup created", {
        fileName: written.fileName,
        directory: written.directory,
        includesSecrets: true,
      });

      response.json({
        ok: true,
        includesSecrets: true,
        fileName: written.fileName,
        directory: written.directory,
        createdAt: backup.exportedAt,
        message: `Safety backup created: ${written.fileName}`,
      });
    } catch (error) {
      await appLog.warn("Pre-update backup failed", {
        message: error.message || "Unable to create pre-update backup",
      });
      next(error);
    }
  });

  router.post("/summary", async (request, response) => {
    const backup = normalizedBackup(request.body);
    if (!backup) {
      invalidBackupResponse(response);
      return;
    }
    const validationErrors = backupDataValidationErrors(backup);
    if (validationErrors.length > 0) {
      invalidBackupDataResponse(response, validationErrors);
      return;
    }

    response.json({
      ok: true,
      summary: backupImportSummary(backup),
    });
  });

  router.post("/import", async (request, response, next) => {
    try {
      const parsed = parseImportRequest(request.body);
      const mode = parsed.mode;
      const sections = parsed.sections;
      if (!parsed.validMode) {
        response.status(400).json({
          error: "invalid_restore_mode",
          message: "Choose valid restore sections.",
        });
        return;
      }
      const backup = normalizedBackup(parsed.backup);
      if (!backup) {
        invalidBackupResponse(response);
        return;
      }
      const validationErrors = backupDataValidationErrors(backup);
      if (validationErrors.length > 0) {
        invalidBackupDataResponse(response, validationErrors);
        return;
      }

      const result = await pendingMutations.run("backup-import", async () => {
        const currentSettings = mergeSettings(
          defaults,
          await stores.settingsStore.read(),
        );
        let settings = null;
        if (shouldRestore(sections, "settings")) {
          settings = normalizeRuntimeManagedSettings(
            backup.includesSecrets
              ? mergeSettings(defaults, backup.data.settings)
              : mergeSettings(
                  currentSettings,
                  removeMaskedSecrets(backup.data.settings),
                ),
            defaults,
          );
          const errors = validateSettings(settings);
          if (errors.length > 0) {
            return {
              status: 400,
              body: {
                error: "invalid_backup_settings",
                details: errors,
              },
            };
          }
        }

        let preImportBackup;
        try {
          const safetyBackup = await createBackup({
            stores,
            defaults,
            includeSecrets: backup.includesSecrets === true,
          });
          preImportBackup = await writeBackupFile({
            backup: safetyBackup,
            directory: currentSettings.Backups?.Directory || defaults.Backups.Directory,
            label: "pre-import",
          });
          await appLog.info("Pre-import backup created", {
            fileName: preImportBackup.fileName,
            directory: preImportBackup.directory,
            includesSecrets: safetyBackup.includesSecrets,
          });
        } catch (error) {
          await appLog.warn("Pre-import backup failed", {
            message: error.message || "Unable to create pre-import backup",
          });
          return {
            status: 500,
            body: {
              error: "pre_import_backup_failed",
              message:
                "Import stopped because Scrubarr could not create a safety backup first.",
              details: error.message || "Unable to create pre-import backup",
            },
          };
        }

        const writer = createImportWriter();
        let reconciled = {
          found: 0,
          added: 0,
          message: "No managed Leaving Soon queue entries were found.",
        };
        try {
          if (shouldRestore(sections, "settings")) {
            await writer.write("settings", stores.settingsStore, settings);
          }
          if (shouldRestore(sections, "pending")) {
            await writer.write("pending", stores.pendingStore, asArray(backup.data.pending));
          }
          if (shouldRestore(sections, "activity") || shouldRestore(sections, "pending")) {
            await writer.write("inProgress", stores.inProgressStore, asArray(backup.data.inProgress));
          }
          if (shouldRestore(sections, "exclusions")) {
            await writer.write("exclusions", stores.exclusionsStore, asArray(backup.data.exclusions));
          }
          if (shouldRestore(sections, "scheduler")) {
            await writer.write("scheduler", stores.schedulerStore, backup.data.scheduler || {});
          }
          if (shouldRestore(sections, "history")) {
            await writer.write("runLog", stores.runLogStore, asArray(backup.data.runLog));
            await writer.write("deletionStats", stores.deletionStatsStore, backup.data.deletionStats || {});
          }

          const restoredSettings = shouldRestore(sections, "settings")
            ? settings
            : currentSettings;
          reconciled = await rebuildPendingFromDeletionQueue({
            settings: restoredSettings,
            existingPending: await stores.pendingStore.read(),
            backupPending: backup.data.pending,
            manifestDirectory: librarySyncManifestDirectory,
            timezone,
          });
          if (reconciled.added > 0) {
            await writer.write("pending", stores.pendingStore, reconciled.pending);
          }
        } catch (error) {
          await writer.rollback(appLog);
          throw error;
        }

        await appLog.info("Backup imported", {
          mode,
          sections,
          includesSecrets: Boolean(backup.includesSecrets),
          pendingCount: asArray(backup.data.pending).length,
          exclusionCount: asArray(backup.data.exclusions).length,
          queueRebuildAdded: reconciled.added,
        });
        return {
          status: 200,
          body: {
            ok: true,
            mode,
            sections,
            summary: backupImportSummary(backup),
            queueRebuild: {
              found: reconciled.found,
              added: reconciled.added,
              message: reconciled.message,
            },
            preImportBackup: {
              fileName: preImportBackup.fileName,
              directory: preImportBackup.directory,
            },
            message: `Backup imported. Safety backup created: ${preImportBackup.fileName}. ${reconciled.message} Restart Scrubarr if authentication settings changed.`,
          },
        };
      });
      response.status(result.status).json(result.body);
    } catch (error) {
      if (isPendingMutationBusy(error)) {
        response.status(409).json({
          error: error.code,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
