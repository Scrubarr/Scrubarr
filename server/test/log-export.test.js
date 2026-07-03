import assert from "node:assert/strict";
import test from "node:test";
import {
  createLogsZip,
  formatAppLogExport,
  formatRunLogExport,
  logExportFileName,
  logsZipFileName,
} from "../src/services/log-export.js";

test("run log export is human readable and includes deletion totals", () => {
  const content = formatRunLogExport([
    {
      type: "deletion",
      source: "scheduler",
      status: "success",
      dryRun: false,
      startedAt: "2026-06-25T01:00:00.000Z",
      completedAt: "2026-06-25T01:00:02.000Z",
      expiredTotal: 2,
      expiredMovies: 1,
      expiredSeries: 1,
      deletedTotal: 2,
      deletedMovies: 1,
      deletedSeries: 1,
      failedTotal: 0,
      telegram: {
        enabled: true,
        sent: true,
        messageCount: 1,
        message: "Sent deletion report.",
      },
      deletedItems: [
        { Title: "Movie One", Type: "Movie", Year: 2020, DeletionMethod: "Radarr" },
        { Title: "Series One", Type: "Series", Year: 2018, DeletionMethod: "Sonarr" },
      ],
    },
  ]);

  assert.match(content, /\[2026-06-25T01:00:02.000Z\] Scheduled deletion check \(scheduler\) - success/);
  assert.match(content, /Movies deleted: 1/);
  assert.match(content, /Series deleted: 1/);
  assert.match(content, /Movie One \(2020\) - Movie via Radarr/);
  assert.match(content, /Telegram deletion report: enabled=true, sent=true, messageCount=1/);
  assert.doesNotMatch(content, /^\s*\{/m, "content should not be raw JSON only");
});

test("run log export includes failed deletion reasons", () => {
  const content = formatRunLogExport([
    {
      type: "deletion",
      source: "scheduler",
      status: "partial",
      dryRun: false,
      completedAt: "2026-06-25T01:00:02.000Z",
      failedTotal: 1,
      failedItems: [
        {
          Title: "Stubborn Movie",
          Type: "Movie",
          DeleteError: "Radarr rejected the delete request",
        },
      ],
      failureTelegram: {
        enabled: true,
        sent: true,
        messageCount: 1,
      },
    },
  ]);

  assert.match(content, /Failed total: 1/);
  assert.match(content, /Stubborn Movie - Movie - Radarr rejected the delete request/);
  assert.match(content, /Telegram failure report: enabled=true, sent=true, messageCount=1/);
});

test("run log export labels scheduled scans and uses cleanup mode", () => {
  const content = formatRunLogExport([
    {
      type: "scan",
      source: "scheduler",
      status: "success",
      readOnly: true,
      startedAt: "2026-06-25T01:00:00.000Z",
      completedAt: "2026-06-25T01:00:02.000Z",
      scanned: 10,
      candidates: 2,
      candidateMovies: 1,
      candidateSeries: 1,
      cleanup: {
        status: "success",
        dryRun: false,
        expired: 1,
        deleted: 1,
        failed: 0,
      },
      librarySync: {
        status: "success",
        enabled: true,
        refreshed: true,
        pending: 2,
      },
    },
  ]);

  assert.match(content, /\[2026-06-25T01:00:02.000Z\] Scheduled scan \(scheduler\) - success/);
  assert.match(content, /Mode: Live mode/);
  assert.match(content, /Scanned: 10/);
  assert.match(content, /Media server library sync: status=success, enabled=true/);
  assert.doesNotMatch(content, /Leaving Soon sync/);
});

test("app log export redacts secret-looking fields", () => {
  const content = formatAppLogExport(
    `${JSON.stringify({
      timestamp: "2026-06-25T01:00:00.000Z",
      level: "info",
      message: "Connection tested",
      apiKey: "secret-key",
      nested: { token: "secret-token", safe: "ok" },
    })}\n`,
  );

  assert.match(content, /\[2026-06-25T01:00:00.000Z\] INFO Connection tested/);
  assert.match(content, /apiKey=\[REDACTED\]/);
  assert.match(content, /"token":"\[REDACTED\]"/);
  assert.doesNotMatch(content, /secret-key|secret-token/);
});

test("log export filenames use the requested log type", () => {
  const date = new Date("2026-06-25T12:00:00.000Z");

  assert.equal(logExportFileName("run", date), "Scrubarr-run-log-2026-06-25.log");
  assert.equal(logExportFileName("app", date), "Scrubarr-app-log-2026-06-25.log");
  assert.equal(logsZipFileName(date), "Scrubarr-logs-2026-06-25.zip");
});

function readStoredZip(buffer) {
  const entries = [];
  let offset = 0;

  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const contentEnd = contentStart + compressedSize;

    assert.equal(compression, 0, "log archive should use stored entries");
    entries.push({
      name: buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      content: buffer.subarray(contentStart, contentEnd).toString("utf8"),
    });
    offset = contentEnd;
  }

  assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "central directory should follow entries");
  assert.equal(
    buffer.readUInt32LE(buffer.length - 22),
    0x06054b50,
    "archive should include an end-of-central-directory record",
  );
  return entries;
}

test("combined logs zip contains run and app log files", () => {
  const date = new Date("2026-06-25T12:00:00.000Z");
  const archive = createLogsZip(
    [
      { name: logExportFileName("run", date), content: "Run log line\n" },
      { name: logExportFileName("app", date), content: "App log line\n" },
    ],
    date,
  );

  const entries = readStoredZip(archive);
  assert.deepEqual(entries, [
    { name: "Scrubarr-run-log-2026-06-25.log", content: "Run log line\n" },
    { name: "Scrubarr-app-log-2026-06-25.log", content: "App log line\n" },
  ]);
});
