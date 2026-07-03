import assert from "node:assert/strict";
import test from "node:test";
import { logTelegramDeletionReportSummaries } from "../src/app/workflows.js";

function mockAppLog() {
  const entries = [];
  return {
    entries,
    async info(message, fields) {
      entries.push({ level: "info", message, fields });
    },
    async warn(message, fields) {
      entries.push({ level: "warn", message, fields });
    },
  };
}

test("logs Telegram deletion report summaries without message contents", async () => {
  const appLog = mockAppLog();

  await logTelegramDeletionReportSummaries(appLog, {
    dryRun: false,
    telegram: {
      enabled: true,
      sent: true,
      messageCount: 1,
      message: "Sent Telegram report for 6 item(s).",
    },
    failureTelegram: {
      enabled: true,
      sent: false,
      messageCount: 0,
      message: "No deletion failures.",
    },
  });

  assert.deepEqual(appLog.entries.map((entry) => entry.message), [
    "Telegram deletion report sent",
    "Telegram deletion failure report not sent",
  ]);
  assert.equal(appLog.entries[0].fields.messageCount, 1);
  assert.equal(appLog.entries[0].fields.sent, true);
});

test("logs failed Telegram reports as warnings", async () => {
  const appLog = mockAppLog();

  await logTelegramDeletionReportSummaries(appLog, {
    dryRun: true,
    telegram: {
      enabled: true,
      sent: false,
      messageCount: 0,
      message: "Telegram dry-run deletion report failed.",
    },
    failureTelegram: null,
  });

  assert.equal(appLog.entries.length, 1);
  assert.equal(appLog.entries[0].level, "warn");
  assert.equal(appLog.entries[0].message, "Telegram preview deletion report failed");
});
