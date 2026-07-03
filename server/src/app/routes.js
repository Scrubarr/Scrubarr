import { createHealthRouter, createHealthStatusRouter } from "../routes/health.js";
import { createSettingsRouter } from "../routes/settings.js";
import { createExclusionsRouter } from "../routes/exclusions.js";
import { createScansRouter } from "../routes/scans.js";
import { createPendingRouter } from "../routes/pending.js";
import { createTelegramRouter } from "../routes/telegram.js";
import { createSchedulerRouter } from "../routes/scheduler.js";
import { createLogsRouter } from "../routes/logs.js";
import { createBackupRouter } from "../routes/backup.js";
import { createDashboardRouter } from "../routes/dashboard.js";
import { createLibrariesRouter } from "../routes/libraries.js";
import { createBasicAuthMiddleware } from "../services/auth.js";

function createOriginGuard() {
  return (request, response, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      next();
      return;
    }
    const origin = request.get("Origin");
    if (!origin) {
      next();
      return;
    }
    try {
      const host = request.get("Host");
      const originUrl = new URL(origin);
      const requestHost = host ? new URL(`http://${host}`).hostname : "";
      const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
      if (
        host &&
        (originUrl.host === host ||
          (localHosts.has(originUrl.hostname) && localHosts.has(requestHost)))
      ) {
        next();
        return;
      }
    } catch {
      // fall through to the rejection below
    }
    response.status(403).json({ error: "invalid_origin" });
  };
}

export function mountApiRoutes(app, context) {
  const {
    runtime,
    stores,
    defaults,
    scheduler,
    automaticUpdateChecks,
    scanCoordinator,
    runLog,
    deletionStats,
    appLog,
    workflows,
    pendingMutations,
  } = context;

  app.use("/api/health", createHealthRouter());
  app.use(
    createBasicAuthMiddleware({ settingsStore: stores.settingsStore, defaults, appLog }),
  );
  app.use(
    "/api/health",
    createHealthStatusRouter(
      runtime,
      scheduler,
      stores.settingsStore,
      defaults,
      automaticUpdateChecks,
    ),
  );
  app.use(createOriginGuard());
  app.use(
    "/api/scheduler",
    createSchedulerRouter(scheduler, {
      getMode: workflows.currentCleanupMode,
    }),
  );
  app.use(
    "/api/dashboard",
    createDashboardRouter({
      settingsStore: stores.settingsStore,
      pendingStore: stores.pendingStore,
      exclusionsStore: stores.exclusionsStore,
      deletionStats,
      defaults,
    }),
  );
  app.use("/api/logs", createLogsRouter({ runLog, appLog }));
  app.use(
    "/api/backup",
    createBackupRouter({
      stores,
      defaults,
      appLog,
      librarySyncManifestDirectory: runtime.librarySyncManifestDirectory,
      timezone: runtime.timezone,
      pendingMutations,
    }),
  );
  app.use(
    "/api/libraries",
    createLibrariesRouter({
      syncLibraries: () =>
        workflows.syncCurrentDeletionLibraries({ source: "manual" }),
    }),
  );
  app.use(
    "/api/settings",
    createSettingsRouter({
      settingsStore: stores.settingsStore,
      defaults,
      updateManifestUrl: runtime.updateManifestUrl,
      updateChecks: automaticUpdateChecks,
      onSettingsSaved: async () => {
        await automaticUpdateChecks.refresh();
      },
    }),
  );
  app.use(
    "/api/exclusions",
    createExclusionsRouter({
      exclusionsStore: stores.exclusionsStore,
      pendingStore: stores.pendingStore,
      settingsStore: stores.settingsStore,
      defaults,
      onPendingRemoved: (items) =>
        workflows.untagPendingItems(items, { source: "exclusions" }),
      onPendingChanged: () =>
        workflows.syncCurrentDeletionLibraries({ source: "exclusions" }),
    }),
  );
  app.use(
    "/api/scans",
    createScansRouter({
      exclusionsStore: stores.exclusionsStore,
      pendingStore: stores.pendingStore,
      settingsStore: stores.settingsStore,
      inProgressStore: stores.inProgressStore,
      defaults,
      timezone: runtime.timezone,
      scanCoordinator,
      runLog,
      pendingMutations,
      onPendingAdded: (items) =>
        workflows.tagPendingItems(items, { source: "queue-commit" }),
      onPendingChanged: () =>
        workflows.syncCurrentDeletionLibraries({ source: "queue-commit" }),
    }),
  );
  app.use(
    "/api/pending",
    createPendingRouter({
      pendingStore: stores.pendingStore,
      exclusionsStore: stores.exclusionsStore,
      settingsStore: stores.settingsStore,
      defaults,
      timezone: runtime.timezone,
      librarySyncManifestDirectory: runtime.librarySyncManifestDirectory,
      pendingMutations,
      onPendingRemoved: (items) =>
        workflows.untagPendingItems(items, { source: "pending" }),
      onPendingChanged: () =>
        workflows.syncCurrentDeletionLibraries({ source: "pending" }),
    }),
  );
  app.use(
    "/api/telegram",
    createTelegramRouter({
      settingsStore: stores.settingsStore,
      defaults,
    }),
  );
}
