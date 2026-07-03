import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { pendingIntegrityReport } from "../src/services/pending-integrity.js";

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

async function writeManifest(manifestDirectory, type, manifest) {
  await fs.mkdir(manifestDirectory, { recursive: true });
  await fs.writeFile(
    path.join(manifestDirectory, `deletion-library-${type.toLowerCase()}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

function createSettings({ movieQueue }) {
  const settings = createDefaultSettings({
    dataDirectory: "./data",
    logDirectory: "./logs",
  });
  settings.Emby.CreateDeletionLibraries = true;
  settings.Emby.ToBeDeletedPaths.Movies = movieQueue;
  settings.Emby.QueueWritePaths.Movies = "";
  return settings;
}

test("pending integrity flags restored records missing from queue folders", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-integrity-"));
  const movieQueue = path.join(directory, "queue", "movies");
  const sourceDirectory = path.join(directory, "sources");
  const manifestDirectory = path.join(directory, "manifest");
  const okLink = path.join(movieQueue, "Current Movie.strm");
  const missingSourceLink = path.join(movieQueue, "Missing Source.strm");
  const okSource = path.join(sourceDirectory, "current.mkv");
  const missingSource = path.join(sourceDirectory, "missing.mkv");

  try {
    await fs.mkdir(movieQueue, { recursive: true });
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(okLink, `${okSource}\n`, "utf8");
    await fs.writeFile(missingSourceLink, `${missingSource}\n`, "utf8");
    await fs.writeFile(okSource, "media", "utf8");
    await writeManifest(manifestDirectory, "Movie", {
      current: { path: okLink, target: okSource, mode: "strm" },
      "missing-source": {
        path: missingSourceLink,
        target: missingSource,
        mode: "strm",
      },
    });

    const report = await pendingIntegrityReport({
      pending: [
        { ItemId: "current", Title: "Current Movie", Type: "Movie" },
        { ItemId: "restored", Title: "Restored Movie", Type: "Movie" },
        { ItemId: "missing-source", Title: "Missing Source", Type: "Movie" },
      ],
      settings: createSettings({ movieQueue }),
      manifestDirectory,
    });

    assert.equal(report.ok, false);
    assert.equal(report.pendingTotal, 3);
    assert.equal(report.staleCount, 2);
    assert.deepEqual(
      report.items.map((item) => item.ItemId).sort(),
      ["missing-source", "restored"],
    );
    assert.deepEqual(
      report.items
        .find((item) => item.ItemId === "restored")
        .issues.map((issue) => issue.code),
      ["missing_queue_entry"],
    );
    assert.deepEqual(
      report.items
        .find((item) => item.ItemId === "missing-source")
        .issues.map((issue) => issue.code),
      ["missing_source_file"],
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("pending integrity flags missing Arr records without deleting queue entries", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-arr-integrity-"));
  const movieQueue = path.join(directory, "queue", "movies");
  const sourceDirectory = path.join(directory, "sources");
  const manifestDirectory = path.join(directory, "manifest");
  const linkPath = path.join(movieQueue, "Missing Arr Movie.strm");
  const sourcePath = path.join(sourceDirectory, "missing-arr.mkv");
  const arrServer = http.createServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "Not found" }));
  });
  const port = await listen(arrServer);

  try {
    await fs.mkdir(movieQueue, { recursive: true });
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(linkPath, `${sourcePath}\n`, "utf8");
    await fs.writeFile(sourcePath, "media", "utf8");
    await writeManifest(manifestDirectory, "Movie", {
      "missing-arr": { path: linkPath, target: sourcePath, mode: "strm" },
    });

    const settings = createSettings({ movieQueue });
    settings.Arrs.Radarr.Enabled = true;
    settings.Arrs.Radarr.Url = `http://127.0.0.1:${port}`;
    settings.Arrs.Radarr.ApiKey = "test-key";

    const report = await pendingIntegrityReport({
      pending: [
        {
          ItemId: "missing-arr",
          Title: "Missing Arr Movie",
          Type: "Movie",
          ArrId: 99,
        },
      ],
      settings,
      manifestDirectory,
    });

    assert.equal(report.ok, false);
    assert.equal(report.staleCount, 1);
    assert.deepEqual(
      report.items[0].issues.map((issue) => issue.code),
      ["missing_arr_record"],
    );
  } finally {
    await close(arrServer);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
