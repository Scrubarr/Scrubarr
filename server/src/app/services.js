import { ScanCoordinator } from "../services/scan-coordinator.js";
import { SchedulerService } from "../services/scheduler.js";
import { AutomaticUpdateCheckService } from "../services/automatic-update-checks.js";

export function createAppServices({
  runtime,
  stores,
  defaults,
  runLog,
  appLog,
  workflows,
  pendingMutations,
}) {
  const scanCoordinator = new ScanCoordinator({
    settingsStore: stores.settingsStore,
    exclusionsStore: stores.exclusionsStore,
    pendingStore: stores.pendingStore,
    inProgressStore: stores.inProgressStore,
    defaults,
  });
  const scheduler = new SchedulerService({
    store: stores.schedulerStore,
    scanCoordinator,
    timezone: runtime.timezone,
    runLog,
    librarySync: () =>
      workflows.syncCurrentDeletionLibraries({ source: "scheduler" }),
    arrTagging: (items) =>
      workflows.tagPendingItems(items, { source: "scheduler" }),
    notifications: workflows.sendScheduledTelegramNotifications,
    cleanup: workflows.runScheduledCleanup,
    pendingMutations,
  });
  const automaticUpdateChecks = new AutomaticUpdateCheckService({
    store: stores.updateCheckStore,
    settingsStore: stores.settingsStore,
    defaults,
    updateManifestUrl: runtime.updateManifestUrl,
    appLog,
  });

  return {
    automaticUpdateChecks,
    scanCoordinator,
    scheduler,
  };
}
