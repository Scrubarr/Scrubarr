import assert from "node:assert/strict";
import test from "node:test";
import {
  entryFromError,
  entryFromPreviewResult,
  RunLogService,
} from "../src/services/run-log.js";

class MemoryStore {
  constructor(value = []) {
    this.value = value;
  }

  async read() {
    return structuredClone(this.value);
  }

  async write(value) {
    this.value = structuredClone(value);
  }
}

test("creates compact read-only preview log entries", () => {
  const entry = entryFromPreviewResult({
    source: "manual",
    startedAt: "2026-06-17T00:00:00.000Z",
    completedAt: "2026-06-17T00:00:01.000Z",
    result: {
      candidates: [{ ItemId: "1" }],
      warnings: ["Radarr unavailable"],
      summary: {
        scanned: 5,
        candidateMovies: 1,
        candidateSeries: 0,
        existingPendingMovies: 2,
        existingPendingSeries: 3,
        skipped: { excluded: 1 },
      },
    },
    librarySync: {
      enabled: true,
      pending: 2,
      refreshed: true,
      message: "Deletion library sync completed.",
    },
  });

  assert.equal(entry.source, "manual");
  assert.equal(entry.type, "preview");
  assert.equal(entry.status, "success");
  assert.equal(entry.readOnly, true);
  assert.equal(entry.candidates, 1);
  assert.equal(entry.librarySync.enabled, true);
  assert.equal(entry.librarySync.refreshed, true);
  assert.deepEqual(entry.warnings, ["Radarr unavailable"]);
  assert.equal(JSON.stringify(entry).includes("ApiKey"), false);
});

test("scheduled scan log entries use scan type", () => {
  const entry = entryFromPreviewResult({
    source: "scheduler",
    startedAt: "2026-06-17T00:00:00.000Z",
    completedAt: "2026-06-17T00:00:01.000Z",
    result: {
      candidates: [],
      warnings: [],
      summary: {
        scanned: 5,
        candidateMovies: 0,
        candidateSeries: 0,
      },
    },
  });

  assert.equal(entry.source, "scheduler");
  assert.equal(entry.type, "scan");
  assert.equal(entry.readOnly, true);
});

test("records failed runs without stack traces", () => {
  const entry = entryFromError({
    source: "scheduler",
    startedAt: "2026-06-17T00:00:00.000Z",
    error: new Error("Emby URL and API key must be configured"),
  });

  assert.equal(entry.status, "failed");
  assert.equal(entry.message, "Emby URL and API key must be configured");
  assert.equal("stack" in entry, false);
});

test("prepends and caps run log entries", async () => {
  const store = new MemoryStore();
  const log = new RunLogService(store);

  for (let index = 0; index < 205; index += 1) {
    await log.append({
      id: String(index),
      source: "manual",
      status: "success",
      completedAt: String(index),
    });
  }

  const entries = await log.list({ limit: 5 });
  assert.deepEqual(entries.map((entry) => entry.id), ["204", "203", "202", "201", "200"]);
  assert.equal(store.value.length, 200);
});

test("returns raw file content fallback when no file path exists", async () => {
  const store = new MemoryStore([{ id: "1", status: "success" }]);
  const log = new RunLogService(store);

  const file = await log.file();

  assert.equal(file.fileName, "RunLog.json");
  assert.match(file.content, /"id": "1"/);
});
