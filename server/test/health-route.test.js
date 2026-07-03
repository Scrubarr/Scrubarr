import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDefaultSettings } from "../src/config/settings.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runtimeFor(directory) {
  return {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    updateCheckFile: path.join(directory, "UpdateCheck.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    appLogFile: path.join(directory, "logs", "Scrubarr.log"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
}

test("health status reports when debug logging is enabled", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-health-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.DebugMode.Enabled = true;
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/status`);
    const status = await response.json();

    assert.equal(response.status, 200);
    assert.equal(status.debugLogging, true);
    assert.equal(status.capabilities.debugLogging, true);
  } finally {
    await close(server);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test("health status leaves media server unselected on a fresh install", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-health-fresh-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/status`);
    const status = await response.json();

    assert.equal(response.status, 200);
    assert.equal(status.mediaServer.provider, null);
    assert.equal(status.mediaServer.label, null);
    assert.equal(status.mediaServer.locked, false);
    assert.equal(status.mediaServer.configured, false);
  } finally {
    await close(server);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test("health status reports whether the media server is configured", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-health-media-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.MediaServer = { Provider: "jellyfin", Locked: true };
  settings.Jellyfin.ServerUrl = "http://jellyfin.local:8096";
  settings.Jellyfin.ApiKey = "jellyfin-key";
  settings.Jellyfin.SearchLibraries = ["Movies", "Shows"];
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/status`);
    const status = await response.json();

    assert.equal(response.status, 200);
    assert.equal(status.mediaServer.provider, "jellyfin");
    assert.equal(status.mediaServer.locked, true);
    assert.equal(status.mediaServer.configured, true);
  } finally {
    await close(server);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test("health status reports update availability from the last update check", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-health-update-"));
  const runtime = runtimeFor(directory);
  runtime.updateManifestUrl = "https://updates.example.test/scrubarr.json";
  const settings = createDefaultSettings(runtime);
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");
  await fs.writeFile(
    runtime.updateCheckFile,
    JSON.stringify({
      lastCheck: {
        status: "success",
        checkedAt: "2026-06-27T00:00:00.000Z",
        configured: true,
        currentVersion: "0.1.5",
        latestVersion: "0.1.6",
        updateAvailable: true,
        releaseUrl: "https://example.test/releases/v0.1.6",
        notes: "Test update",
        message: "Version 0.1.6 is available.",
      },
    }),
    "utf8",
  );

  const app = createApp(runtime);
  await app.locals.automaticUpdateChecks.start();
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/status`);
    const status = await response.json();

    assert.equal(response.status, 200);
    assert.equal(status.updates.configured, true);
    assert.equal(status.updates.updateAvailable, true);
    assert.equal(status.updates.latestVersion, "0.1.6");
    assert.equal(status.updates.releaseUrl, "https://example.test/releases/v0.1.6");
  } finally {
    app.locals.automaticUpdateChecks.stop();
    await close(server);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
