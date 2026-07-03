import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeTelegramHtml,
  findDuePendingNotifications,
  formatDeletionFailureReport,
  formatDeletionReport,
  formatDryRunDeletionReport,
  formatPendingNotification,
  formatTestMessage,
  notificationDaysForPolicy,
  sendDuePendingNotifications,
  sendTelegramMessage,
  splitTelegramMessage,
} from "../src/services/telegram.js";

const specialTitle = "Movie *With* [Special] _Characters_ (2026) \\ test";

test("pending messages group by media type then days remaining", () => {
  const message = formatPendingNotification([
    { Title: "Movie B", Type: "Movie", DaysRemaining: 10 },
    { Title: "Movie A", Type: "Movie", DaysRemaining: 20 },
    { Title: "Show A", Type: "Series", DaysRemaining: 10 },
    { Title: "Show B", Type: "Series", DaysRemaining: 1 },
  ]);

  assert.ok(message.indexOf("🎬 Movies") < message.indexOf("📺 Series"));
  assert.ok(message.indexOf("20 day(s) remaining") < message.indexOf("10 day(s) remaining"));
  assert.match(message, /• Movie A/);
  assert.match(message, /• Show B/);
});

test("HTML formatting safely escapes title characters", () => {
  const message = formatPendingNotification([
    {
      Title: `${specialTitle} <unsafe> & more`,
      Type: "Movie",
      DaysRemaining: 5,
    },
  ]);

  assert.ok(message.includes(specialTitle));
  assert.ok(message.includes("&lt;unsafe&gt; &amp; more"));
  assert.equal(message.includes("<unsafe>"), false);
});

test("deletion reports include media totals and omit countdown suffixes", () => {
  const items = [
    { Title: "Deleted Movie", Type: "Movie" },
    { Title: "Deleted Series", Type: "Series" },
  ];
  const real = formatDeletionReport(items);
  const dryRun = formatDryRunDeletionReport(items);

  assert.equal(real.includes("day(s)"), false);
  assert.equal(dryRun.includes("day(s)"), false);
  assert.match(real, /Movies deleted: 1/);
  assert.match(real, /Series deleted: 1/);
  assert.match(dryRun, /No media files were actually deleted/);
  assert.match(real, /Deletion Report ☠/);
  assert.match(real, /<b>🧽 Scrubarr/);
});

test("test message clearly states that no scan or deletion occurred", () => {
  const message = formatTestMessage();
  assert.match(message, /configured correctly/);
  assert.match(message, /No scan or deletion was performed/);
});

test("production Telegram message formats render expected content", () => {
  const pending = formatPendingNotification([
    {
      Title: specialTitle,
      Type: "Movie",
      DaysRemaining: 20,
    },
  ]);
  const deletion = formatDeletionReport([{ Title: "Deleted Movie", Type: "Movie" }]);
  const dryRun = formatDryRunDeletionReport([{ Title: "Dry Run Movie", Type: "Movie" }]);
  const failure = formatDeletionFailureReport([{ Title: "Failed Movie", Type: "Movie" }]);

  assert.ok(pending.includes(specialTitle));
  assert.match(deletion, /Deletion Report/);
  assert.match(dryRun, /Preview Only Deletion Report/);
  assert.match(dryRun, /No media files were actually deleted/);
  assert.match(failure, /Deletion Failures/);
});

test("Telegram HTML escaping covers all required entities", () => {
  assert.equal(
    escapeTelegramHtml("Rock & Roll <Part 2>"),
    "Rock &amp; Roll &lt;Part 2&gt;",
  );
});

test("long Telegram messages split on line boundaries", () => {
  const parts = splitTelegramMessage(
    Array.from({ length: 20 }, (_, index) => `Line ${index} with content`).join("\n"),
    80,
  );
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 80));
  assert.equal(parts.join("\n").includes("Line 19 with content"), true);
});

test("sender uses Telegram HTML mode", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    };
  };

  const result = await sendTelegramMessage(
    { BotToken: "123:token", ChatID: "-100123" },
    specialTitle,
    fakeFetch,
  );
  const payload = JSON.parse(requests[0].options.body);

  assert.equal(result.messageCount, 1);
  assert.equal(payload.chat_id, "-100123");
  assert.equal(payload.text, specialTitle);
  assert.equal(payload.parse_mode, "HTML");
  assert.equal(payload.disable_web_page_preview, true);
});

test("sender reports Telegram API failures with service context", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ ok: false, description: "chat not found" }),
  });

  await assert.rejects(
    sendTelegramMessage(
      { BotToken: "123:token", ChatID: "-100123" },
      "Test",
      fakeFetch,
    ),
    /Telegram send message failed: chat not found/,
  );
});

test("notification policy days avoid noisy back-to-back standard reminders", () => {
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 20,
      policy: "standard",
    }),
    [20, 10, 5, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 21,
      policy: "standard",
    }),
    [21, 10, 5, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 22,
      policy: "standard",
    }),
    [22, 20, 10, 5, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 11,
      policy: "standard",
    }),
    [11, 5, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 12,
      policy: "standard",
    }),
    [12, 10, 5, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 6,
      policy: "standard",
    }),
    [6, 1],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 7,
      policy: "standard",
    }),
    [7, 5, 1],
  );
});

test("notification policy supports lifecycle-only and full activity", () => {
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 5,
      policy: "lifecycle",
    }),
    [5],
  );
  assert.deepEqual(
    notificationDaysForPolicy({
      daysUntilDeletion: 5,
      policy: "full",
    }),
    [5, 4, 3, 2, 1],
  );
});

test("pending notification sender marks only due items as notified", async () => {
  const settings = {
    Telegram: {
      Enabled: true,
      BotToken: "123:token",
      ChatID: "-100123",
      NotificationPolicy: "standard",
    },
    DeletionSchedule: { DaysUntilDeletion: 20, NotificationDays: [20, 10, 5, 1] },
  };
  const pending = [
    { Title: "Due Movie", Type: "Movie", MarkedDate: "2026-06-20", Notified: [] },
    { Title: "Already Sent", Type: "Movie", MarkedDate: "2026-06-20", Notified: [20] },
    { Title: "Not Due", Type: "Series", MarkedDate: "2026-06-15", Notified: [] },
  ];
  const sent = [];

  const due = findDuePendingNotifications({
    pending,
    settings,
    now: new Date("2026-06-20T04:00:00.000Z"),
    timezone: "Pacific/Auckland",
  });
  assert.equal(due.length, 1);
  assert.equal(due[0].item.Title, "Due Movie");

  const result = await sendDuePendingNotifications({
    settings,
    pending,
    now: new Date("2026-06-20T04:00:00.000Z"),
    timezone: "Pacific/Auckland",
    sendMessage: async (_config, message) => {
      sent.push(message);
      return { messageCount: 1 };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(result.due, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(result.pending[0].Notified, [20]);
  assert.deepEqual(result.pending[1].Notified, [20]);
  assert.deepEqual(result.pending[2].Notified, []);
});
