import { ScanCoordinator } from "../services/scan-coordinator.js";
import { SchedulerService } from "../services/scheduler.js";
import { AutomaticUpdateCheckService } from "../services/automatic-update-checks.js";
import { mergeSettings } from "../config/settings.js";
import { sendRunHealthNotification } from "../services/run-alerts.js";

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
    runHealthNotification: async (event) => {
      const settings = mergeSettings(defaults, await stores.settingsStore.read());
      const result = await sendRunHealthNotification(settings, event);
      try {
        await appLog.info("Telegram scheduled-run health notification", {
          sent: result.sent,
          enabled: result.enabled,
          recovery: event.issues.length === 0,
        });
      } catch {
        // Preserve confirmed delivery even if the application log cannot be written.
      }
      return result;
    },
    onAlertError: (error) => appLog.warn("Telegram scheduled-run health notification failed", {
      message: error.message,
    }),
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
