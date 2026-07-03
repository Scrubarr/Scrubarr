import path from "node:path";
import { JsonStore } from "../storage/json-store.js";

export function createStores(runtime) {
  return {
    pendingStore: new JsonStore(runtime.pendingFile, []),
    exclusionsStore: new JsonStore(runtime.exclusionsFile, []),
    inProgressStore: new JsonStore(
      runtime.inProgressFile || path.join(runtime.dataDirectory, "InProgress.json"),
      [],
    ),
    settingsStore: new JsonStore(runtime.configFile, {}),
    schedulerStore: new JsonStore(runtime.schedulerFile, {}),
    updateCheckStore: new JsonStore(
      runtime.updateCheckFile || path.join(runtime.dataDirectory, "UpdateCheck.json"),
      {},
    ),
    runLogStore: new JsonStore(runtime.runLogFile, []),
    deletionStatsStore: new JsonStore(
      runtime.deletionStatsFile ||
        path.join(runtime.dataDirectory, "DeletionStats.json"),
      {},
    ),
  };
}
