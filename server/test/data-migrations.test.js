import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_SCHEMA_VERSION,
  migrateBackup,
  migrateBackupData,
  migratePersistedData,
  migratePersistedStores,
} from "../src/services/data-migrations.js";

class MemoryStore {
  constructor(value) {
    this.value = value;
    this.writes = 0;
  }

  async read() {
    return this.value;
  }

  async write(value) {
    this.value = value;
    this.writes += 1;
  }
}

test("backup data migration normalizes optional collections", () => {
  assert.deepEqual(
    migrateBackupData({
      settings: { AppName: "Scrubarr" },
      pending: [{ ItemId: "1" }],
      exclusions: "not-an-array",
      inProgress: null,
      scheduler: [],
      runLog: [{ id: "run-1" }],
    }),
    {
      settings: { AppName: "Scrubarr" },
      pending: [{ ItemId: "1" }],
      exclusions: [],
      inProgress: [],
      scheduler: {},
      runLog: [{ id: "run-1" }],
      deletionStats: {},
    },
  );
});

test("backup migration stamps the current data schema version", () => {
  const backup = migrateBackup({
    format: "scrubarr-backup",
    version: 1,
    data: {
      pending: [{ ItemId: "pending" }],
    },
  });

  assert.equal(backup.dataSchemaVersion, DATA_SCHEMA_VERSION);
  assert.deepEqual(backup.data.pending, [{ ItemId: "pending" }]);
  assert.deepEqual(backup.data.exclusions, []);
  assert.deepEqual(backup.data.scheduler, {});
  assert.deepEqual(backup.data.deletionStats, {});
});

test("persisted data migration normalizes all known store shapes", () => {
  assert.deepEqual(
    migratePersistedData({
      settings: [],
      pending: { ItemId: "pending" },
      exclusions: [{ ItemId: "excluded" }],
      inProgress: "bad",
      scheduler: { config: { enabled: true } },
      runLog: null,
      updateCheck: { enabled: true },
    }),
    {
      settings: {},
      pending: [],
      exclusions: [{ ItemId: "excluded" }],
      inProgress: [],
      scheduler: { config: { enabled: true } },
      runLog: [],
      deletionStats: {},
      updateCheck: { enabled: true },
    },
  );
});

test("persisted data migration locks old configured Emby installs", () => {
  const migrated = migratePersistedData({
    settings: {
      Emby: {
        ServerUrl: "http://emby.local:8096",
        ApiKey: "emby-key",
      },
    },
  });

  assert.deepEqual(migrated.settings.MediaServer, {
    Provider: "emby",
    Locked: true,
  });
});

test("persisted store migration writes only changed stores", async () => {
  const stores = {
    settingsStore: new MemoryStore({ AppName: "Scrubarr" }),
    pendingStore: new MemoryStore("bad"),
    exclusionsStore: new MemoryStore([]),
    inProgressStore: new MemoryStore(null),
    schedulerStore: new MemoryStore({}),
    runLogStore: new MemoryStore([]),
    deletionStatsStore: new MemoryStore({}),
    updateCheckStore: new MemoryStore([]),
  };
  const messages = [];
  const appLog = {
    async info(message, context) {
      messages.push({ message, context });
    },
  };

  const result = await migratePersistedStores({ stores, appLog });

  assert.equal(result.dataSchemaVersion, DATA_SCHEMA_VERSION);
  assert.deepEqual(result.changed, ["pending", "inProgress", "updateCheck"]);
  assert.deepEqual(stores.pendingStore.value, []);
  assert.deepEqual(stores.inProgressStore.value, []);
  assert.deepEqual(stores.updateCheckStore.value, {});
  assert.equal(stores.settingsStore.writes, 0);
  assert.equal(stores.pendingStore.writes, 1);
  assert.equal(messages[0].message, "Persisted data normalized");
});
