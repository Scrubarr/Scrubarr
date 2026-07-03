import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { AutomaticUpdateCheckService } from "../src/services/automatic-update-checks.js";
import { JsonStore } from "../src/storage/json-store.js";

function store(filePath, fallback) {
  return new JsonStore(filePath, fallback);
}

test("automatic update checks persist successful results and next check status", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-update-check-"));
  const defaults = createDefaultSettings({ dataDirectory: directory });
  const settings = createDefaultSettings({ dataDirectory: directory });
  settings.Updates.AutoCheckEnabled = true;
  const settingsStore = store(path.join(directory, "config.json"), {});
  await settingsStore.write(settings);

  const logEntries = [];
  const service = new AutomaticUpdateCheckService({
    store: store(path.join(directory, "UpdateCheck.json"), {}),
    settingsStore,
    defaults,
    updateManifestUrl: "https://updates.example.test/scrubarr.json",
    intervalMs: 60 * 60 * 1000,
    check: async () => ({
      configured: true,
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://example.test/releases/0.2.0",
      notes: "Test release",
    }),
    appLog: {
      info: async (message, meta) => logEntries.push({ level: "info", message, meta }),
      warn: async (message, meta) => logEntries.push({ level: "warn", message, meta }),
    },
  });

  try {
    await service.start();
    const result = await service.runNow({ source: "test" });
    const status = await service.status();

    assert.equal(result.status, "success");
    assert.equal(result.updateAvailable, true);
    assert.equal(result.latestVersion, "0.2.0");
    assert.equal(status.enabled, true);
    assert.equal(status.configured, true);
    assert.equal(Boolean(status.nextCheck), true);
    assert.equal(
      logEntries.some((entry) => entry.message === "Update check completed"),
      true,
    );
  } finally {
    service.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("automatic update checks stay idle without an update source", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-update-idle-"));
  const defaults = createDefaultSettings({ dataDirectory: directory });
  const settingsStore = store(path.join(directory, "config.json"), {});

  const service = new AutomaticUpdateCheckService({
    store: store(path.join(directory, "UpdateCheck.json"), {}),
    settingsStore,
    defaults,
    updateManifestUrl: "",
    check: async () => {
      throw new Error("should not auto-check without a source");
    },
    appLog: {
      info: async () => {},
      warn: async () => {},
    },
  });

  try {
    await service.start();
    const status = await service.status();

    assert.equal(status.enabled, true);
    assert.equal(status.configured, false);
    assert.equal(status.nextCheck, null);
  } finally {
    service.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
