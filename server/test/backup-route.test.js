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
    runLogFile: path.join(directory, "RunLog.json"),
    appLogFile: path.join(directory, "logs", "Scrubarr.log"),
    deletedDirectory: path.join(directory, "deleted"),
    librarySyncManifestDirectory: path.join(directory, "library-sync"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
}

test("backup export omits secrets and import preserves existing secrets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-backup-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.Emby.ApiKey = "keep-this-secret";
  settings.Arrs.Radarr.ApiKey = "radarr-secret";
  settings.Auth.PasswordHash = "auth-secret-hash";

  await Promise.all([
    fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8"),
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
    fs.writeFile(
      runtime.inProgressFile,
      '[{"ItemId":"resume-1","Type":"Movie","Title":"Resume","FirstSeenDate":"2026-01-01T00:00:00.000Z","LastSeenDate":"2026-01-02T00:00:00.000Z"}]\n',
      "utf8",
    ),
  ]);

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const exported = await (
      await fetch(`http://127.0.0.1:${port}/api/backup/export`)
    ).json();
    assert.equal(exported.includesSecrets, false);
    assert.equal(exported.dataSchemaVersion, 1);
    assert.equal(exported.data.inProgress.length, 1);
    assert.equal(JSON.stringify(exported).includes("keep-this-secret"), false);
    assert.equal(JSON.stringify(exported).includes("auth-secret-hash"), false);

    exported.data.pending = [
      { ItemId: "pending-1", Type: "Movie", Title: "Pending" },
      {
        ItemId: "deleted-1",
        Type: "Movie",
        Title: "Deleted",
        Deleted: "2026-06-25",
      },
    ];
    exported.data.exclusions = [{ ItemId: "excluded-1", Type: "Series", Title: "Excluded" }];
    exported.data.scheduler = { config: { enabled: true } };
    const summaryResponse = await fetch(
      `http://127.0.0.1:${port}/api/backup/summary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exported),
      },
    );
    const summary = await summaryResponse.json();

    assert.equal(summaryResponse.status, 200);
    assert.equal(summary.summary.counts.pending, 1);
    assert.equal(summary.summary.counts.deletedHistory, 1);
    assert.equal(summary.summary.counts.pendingRecords, 2);
    assert.equal(summary.summary.counts.exclusions, 1);
    assert.equal(summary.summary.counts.inProgress, 1);
    assert.equal(summary.summary.schedulerEnabled, true);

    exported.data.settings.AppName = "Imported Scrubarr";
    exported.data.settings.Emby.ApiKey = "";
    exported.data.settings.Logging = {
      LogDirectory: "/backup/logs",
      LogRetentionDays: 7,
    };
    exported.data.settings.Paths = {
      ExclusionsFile: "/backup/exclusions.json",
      TrackFile: "/backup/pending.json",
      DeletedTrackFolder: "/backup/deleted",
    };
    exported.data.settings.Emby.QueueWritePaths = {
      Movies: "/backup/movie-queue",
      Series: "/backup/series-queue",
    };
    const response = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    const importBody = await response.json();
    const importedSettings = JSON.parse(await fs.readFile(runtime.configFile, "utf8"));

    assert.equal(response.status, 200);
    assert.match(importBody.preImportBackup.fileName, /^scrubarr-backup-pre-import-/);
    const preImportBackup = JSON.parse(
      await fs.readFile(
        path.join(directory, "backups", importBody.preImportBackup.fileName),
        "utf8",
      ),
    );
    assert.equal(preImportBackup.includesSecrets, false);
    assert.equal(JSON.stringify(preImportBackup).includes("keep-this-secret"), false);
    assert.equal(importedSettings.AppName, "Imported Scrubarr");
    assert.equal(importedSettings.Emby.ApiKey, "keep-this-secret");
    assert.equal(importedSettings.Auth.PasswordHash, "auth-secret-hash");
    assert.equal(importedSettings.Logging.LogDirectory, settings.Logging.LogDirectory);
    assert.equal(importedSettings.Logging.LogRetentionDays, settings.Logging.LogRetentionDays);
    assert.deepEqual(importedSettings.Paths, settings.Paths);
    assert.deepEqual(
      importedSettings.Emby.QueueWritePaths,
      settings.Emby.QueueWritePaths,
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.inProgressFile, "utf8"))[0].ItemId,
      "resume-1",
    );
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

test("pre-update backup writes a secrets-included safety backup", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-pre-update-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.Emby.ApiKey = "pre-update-secret";
  settings.Telegram.BotToken = "telegram-pre-update-secret";

  await Promise.all([
    fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8"),
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
    fs.writeFile(runtime.inProgressFile, "[]\n", "utf8"),
  ]);

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/backup/pre-update`, {
      method: "POST",
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.includesSecrets, true);
    assert.match(body.fileName, /^scrubarr-backup-pre-update-/);
    const backup = JSON.parse(
      await fs.readFile(path.join(directory, "backups", body.fileName), "utf8"),
    );
    assert.equal(backup.includesSecrets, true);
    assert.equal(backup.data.settings.Emby.ApiKey, "pre-update-secret");
    assert.equal(
      backup.data.settings.Telegram.BotToken,
      "telegram-pre-update-secret",
    );
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

test("backup import can restore exclusions without replacing other data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-backup-mode-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.AppName = "Current Scrubarr";

  await Promise.all([
    fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8"),
    fs.writeFile(
      runtime.pendingFile,
      '[{"ItemId":"keep-pending","Type":"Movie","Title":"Keep Pending"}]\n',
      "utf8",
    ),
    fs.writeFile(
      runtime.exclusionsFile,
      '[{"ItemId":"current-exclusion","Type":"Movie","Title":"Current Exclusion"}]\n',
      "utf8",
    ),
    fs.writeFile(
      runtime.inProgressFile,
      '[{"ItemId":"keep-progress","Type":"Series","Title":"Keep Progress"}]\n',
      "utf8",
    ),
    fs.writeFile(
      runtime.schedulerFile,
      '{"config":{"enabled":false},"lastRun":{"id":"current-scheduler"}}\n',
      "utf8",
    ),
    fs.writeFile(runtime.runLogFile, '[{"id":"current-run"}]\n', "utf8"),
  ]);

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const exported = await (
      await fetch(`http://127.0.0.1:${port}/api/backup/export`)
    ).json();
    exported.data.settings.AppName = "Imported Scrubarr";
    exported.data.pending = [
      { ItemId: "imported-pending", Type: "Movie", Title: "Imported Pending" },
    ];
    exported.data.exclusions = [
      { ItemId: "imported-exclusion", Type: "Series", Title: "Imported Exclusion" },
    ];
    exported.data.inProgress = [
      { ItemId: "imported-progress", Type: "Series", Title: "Imported Progress" },
    ];
    exported.data.scheduler = { config: { enabled: true }, lastRun: { id: "imported" } };
    exported.data.runLog = [{ id: "imported-run" }];

    const invalidModeResponse = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: exported, mode: "everything" }),
    });
    assert.equal(invalidModeResponse.status, 400);

    const response = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: exported, mode: "exclusions" }),
    });
    const importBody = await response.json();

    assert.equal(response.status, 200);
    assert.equal(importBody.mode, "exclusions");
    assert.equal(
      JSON.parse(await fs.readFile(runtime.configFile, "utf8")).AppName,
      "Current Scrubarr",
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.pendingFile, "utf8"))[0].ItemId,
      "keep-pending",
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.exclusionsFile, "utf8"))[0].ItemId,
      "imported-exclusion",
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.inProgressFile, "utf8"))[0].ItemId,
      "keep-progress",
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.schedulerFile, "utf8")).lastRun.id,
      "current-scheduler",
    );
    assert.equal(
      JSON.parse(await fs.readFile(runtime.runLogFile, "utf8"))[0].id,
      "current-run",
    );
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

test("backup import rejects backups with oversized collections", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-backup-large-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);

  await Promise.all([
    fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8"),
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
    fs.writeFile(runtime.inProgressFile, "[]\n", "utf8"),
  ]);

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const exported = await (
      await fetch(`http://127.0.0.1:${port}/api/backup/export`)
    ).json();
    exported.data.pending = Array.from({ length: 5001 }, (_value, index) => ({
      ItemId: `pending-${index}`,
      Type: "Movie",
      Title: "Pending",
    }));

    const summaryResponse = await fetch(`http://127.0.0.1:${port}/api/backup/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    const summaryBody = await summaryResponse.json();

    assert.equal(summaryResponse.status, 400);
    assert.equal(summaryBody.error, "invalid_backup_data");

    const importResponse = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
    });
    const importBody = await importResponse.json();

    assert.equal(importResponse.status, 400);
    assert.equal(importBody.error, "invalid_backup_data");
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

test("backup import rebuilds pending from current Leaving Soon queue manifests", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-backup-queue-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  const movieQueue = path.join(directory, "movie-queue");
  const linkPath = path.join(movieQueue, "Queue Movie (2020).strm");
  settings.Emby.ToBeDeletedPaths.Movies = movieQueue;

  await fs.mkdir(movieQueue, { recursive: true });
  await fs.mkdir(runtime.librarySyncManifestDirectory, { recursive: true });

  await Promise.all([
    fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8"),
    fs.writeFile(runtime.pendingFile, "[]\n", "utf8"),
    fs.writeFile(runtime.exclusionsFile, "[]\n", "utf8"),
    fs.writeFile(linkPath, "/media/Queue Movie.mkv\n", "utf8"),
    fs.writeFile(
      path.join(runtime.librarySyncManifestDirectory, "deletion-library-movie.json"),
      `${JSON.stringify(
        {
          "queue-movie": {
            path: linkPath,
            target: "/media/Queue Movie.mkv",
            mode: "strm",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const exported = await (
      await fetch(`http://127.0.0.1:${port}/api/backup/export`)
    ).json();
    exported.data.pending = [
      { ItemId: "stale-old", Type: "Movie", Title: "Stale Old" },
    ];

    const response = await fetch(`http://127.0.0.1:${port}/api/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup: exported,
        mode: "full",
        sections: ["settings", "exclusions", "scheduler", "activity", "history"],
      }),
    });
    const importBody = await response.json();
    const pending = JSON.parse(await fs.readFile(runtime.pendingFile, "utf8"));

    assert.equal(response.status, 200);
    assert.equal(importBody.queueRebuild.found, 1);
    assert.equal(importBody.queueRebuild.added, 1);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ItemId, "queue-movie");
    assert.equal(pending[0].Title, "Queue Movie");
    assert.equal(pending[0].Type, "Movie");
    assert.equal(pending[0].Year, 2020);
    assert.match(pending[0].MarkedDate, /^\d{4}-\d{2}-\d{2}$/);
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
