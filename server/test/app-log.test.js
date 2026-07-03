import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppLogService } from "../src/services/app-log.js";

test("app log retention prunes entries older than the configured window", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-app-log-"));
  const filePath = path.join(directory, "Scrubarr.log");
  const oldEntry = {
    timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    level: "info",
    message: "old entry",
  };
  const recentEntry = {
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    level: "info",
    message: "recent entry",
  };

  try {
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(oldEntry),
        JSON.stringify(recentEntry),
        "not-json-but-keep-it",
        "",
      ].join("\n"),
      "utf8",
    );

    const appLog = new AppLogService(filePath);
    appLog.setRetentionDaysProvider(async () => 7);
    await appLog.info("current entry");

    const content = await fs.readFile(filePath, "utf8");
    assert.equal(content.includes("old entry"), false);
    assert.equal(content.includes("recent entry"), true);
    assert.equal(content.includes("not-json-but-keep-it"), true);
    assert.equal(content.includes("current entry"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("app log retention is skipped when no valid retention window is configured", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-app-log-"));
  const filePath = path.join(directory, "Scrubarr.log");
  const oldEntry = {
    timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    level: "info",
    message: "old entry",
  };

  try {
    await fs.writeFile(filePath, `${JSON.stringify(oldEntry)}\n`, "utf8");

    const appLog = new AppLogService(filePath);
    appLog.setRetentionDaysProvider(async () => 0);
    await appLog.info("current entry");

    const content = await fs.readFile(filePath, "utf8");
    assert.equal(content.includes("old entry"), true);
    assert.equal(content.includes("current entry"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("app log redacts secret-looking messages and metadata before writing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-app-log-"));
  const filePath = path.join(directory, "Scrubarr.log");

  try {
    const appLog = new AppLogService(filePath);
    await appLog.info(
      "Connection failed apiKey=message-secret https://example.invalid?token=query-secret",
      {
        apiKey: "meta-secret",
        nested: {
          Authorization: "Bearer nested-secret",
          safe: "ok",
        },
      },
    );

    const content = await fs.readFile(filePath, "utf8");
    const entry = JSON.parse(content.trim());

    assert.equal(content.includes("message-secret"), false);
    assert.equal(content.includes("query-secret"), false);
    assert.equal(content.includes("meta-secret"), false);
    assert.equal(content.includes("nested-secret"), false);
    assert.match(entry.message, /apiKey=\[REDACTED\]/);
    assert.match(entry.message, /token=\[REDACTED\]/);
    assert.equal(entry.apiKey, "[REDACTED]");
    assert.equal(entry.nested.Authorization, "[REDACTED]");
    assert.equal(entry.nested.safe, "ok");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("app log file view redacts legacy raw lines before returning content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-app-log-"));
  const filePath = path.join(directory, "Scrubarr.log");

  try {
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          timestamp: "2026-06-25T01:00:00.000Z",
          level: "info",
          message: "Legacy apiKey=message-secret",
          token: "legacy-token",
          nested: { Authorization: "Bearer nested-secret", safe: "ok" },
        }),
        "raw password=plain-secret https://example.invalid?token=query-secret",
      ].join("\n"),
      "utf8",
    );

    const appLog = new AppLogService(filePath);
    const file = await appLog.file();

    assert.equal(file.content.includes("message-secret"), false);
    assert.equal(file.content.includes("legacy-token"), false);
    assert.equal(file.content.includes("nested-secret"), false);
    assert.equal(file.content.includes("plain-secret"), false);
    assert.equal(file.content.includes("query-secret"), false);
    assert.match(file.content, /apiKey=\[REDACTED\]/);
    assert.match(file.content, /"token":"\[REDACTED\]"/);
    assert.match(file.content, /password=\[REDACTED\]/);
    assert.match(file.content, /token=\[REDACTED\]/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
