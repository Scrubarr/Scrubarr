import express from "express";
import fs from "node:fs";
import path from "node:path";
import {
  createDefaultSettings,
  mergeSettings,
  unsafeObjectKeyPath,
} from "./config/settings.js";
import { RunLogService } from "./services/run-log.js";
import { DeletionStatsService } from "./services/deletion-stats.js";
import { AppLogService } from "./services/app-log.js";
import { migratePersistedStores } from "./services/data-migrations.js";
import { PendingMutationCoordinator } from "./services/pending-mutation-coordinator.js";
import { redactText, safeMessage } from "./services/log-redaction.js";
import { createStores } from "./app/stores.js";
import { createMaintenanceWorkflows } from "./app/workflows.js";
import { createAppServices } from "./app/services.js";
import { mountApiRoutes } from "./app/routes.js";

function safeConsoleError(error) {
  console.error(redactText(safeMessage(error)));
}

export function createApp(runtime) {
  const app = express();

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data:",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; "),
    );
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use((request, response, next) => {
    const unsafePath = unsafeObjectKeyPath(request.body);
    if (unsafePath) {
      response.status(400).json({
        error: "invalid_request",
        message: "Request body contains an unsupported object key.",
      });
      return;
    }
    next();
  });

  const stores = createStores(runtime);
  const runLog = new RunLogService(stores.runLogStore);
  const deletionStats = new DeletionStatsService(stores.deletionStatsStore, {
    pendingStore: stores.pendingStore,
  });
  const appLog = new AppLogService(runtime.appLogFile);
  const pendingMutations = new PendingMutationCoordinator();
  const defaults = createDefaultSettings(runtime);
  appLog.setDebugEnabledProvider(async () => {
    const settings = mergeSettings(defaults, await stores.settingsStore.read());
    return settings.DebugMode.Enabled === true;
  });
  appLog.setRetentionDaysProvider(async () => {
    const settings = mergeSettings(defaults, await stores.settingsStore.read());
    return settings.Logging.LogRetentionDays;
  });

  const workflows = createMaintenanceWorkflows({
    runtime,
    stores,
    defaults,
    runLog,
    deletionStats,
    appLog,
    pendingMutations,
  });
  const {
    scheduler,
    automaticUpdateChecks,
    scanCoordinator,
  } = createAppServices({
    runtime,
    stores,
    defaults,
    runLog,
    appLog,
    workflows,
    pendingMutations,
  });

  app.locals.scheduler = scheduler;
  app.locals.automaticUpdateChecks = automaticUpdateChecks;
  app.locals.appLog = appLog;
  app.locals.migratePersistedData = () =>
    migratePersistedStores({ stores, appLog });

  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on("finish", () => {
      appLog.debug("HTTP request completed", {
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      }).catch(safeConsoleError);
      if (response.statusCode >= 400) {
        appLog.warn("HTTP request completed with error status", {
          method: request.method,
          path: request.originalUrl,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        }).catch(safeConsoleError);
      }
    });
    next();
  });

  mountApiRoutes(app, {
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
  });

  if (fs.existsSync(runtime.clientDistDirectory)) {
    app.use(express.static(runtime.clientDistDirectory));
    app.get("/{*path}", (request, response, next) => {
      if (request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(runtime.clientDistDirectory, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "not_found" });
  });

  app.use((error, request, response, _next) => {
    safeConsoleError(error);
    appLog.error(error, {
      method: request.method,
      path: request.originalUrl,
    }).catch(safeConsoleError);
    response.status(500).json({ error: "internal_server_error" });
  });

  return app;
}
