import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeTelegramHtml,
  findDuePendingNotifications,
  formatDeletionFailureReport,
  formatDeletionDeferredReport,
  formatDeletionReport,
  formatDryRunDeletionReport,
  formatPendingNotification,
  formatPendingRemovalReport,
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
  assert.ok(message.indexOf("20 days remaining:") < message.indexOf("10 days remaining:"));
  assert.deepEqual(message.split("\n").filter((line) => line.includes("remaining:")), [
    "<u>20 days remaining:</u>",
    "<u>10 days remaining:</u>",
    "<u>10 days remaining:</u>",
    "<u>1 day remaining:</u>",
  ]);
  assert.equal(message.includes("day(s)"), false);
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

test("deletion deferral reports distinguish safety protection from failure", () => {
  const message = formatDeletionDeferredReport([
    {
      Title: "Special Ops: Lioness <2023>",
      Type: "Series",
      SkipCode: "in-progress",
    },
    {
      Title: "Playing Movie",
      Type: "Movie",
      SkipCode: "media-in-use",
    },
  ]);

  assert.match(message, /Deletion Deferred for Safety/);
  assert.match(message, /Special Ops: Lioness &lt;2023&gt;/);
  assert.match(message, /Partially watched; in-progress protection is enabled/);
  assert.match(message, /Currently playing or paused; active playback protection is enabled/);
  assert.match(message, /remain pending/);
  assert.doesNotMatch(message, /Deletion Failures/);
});

test("pending queue update reports explain rule-based removal without implying deletion", () => {
  const message = formatPendingRemovalReport([{
    Title: "Recently Watched <Movie>",
    Type: "Movie",
    SkipCode: "age-rule-not-met",
  }]);

  assert.match(message, /↩️ Scrubarr · Kept in library/);
  assert.match(message, /removed these items from Pending Deletions/);
  assert.match(message, /• <b>Recently Watched &lt;Movie&gt;<\/b>/);
  assert.match(message, /watch history no longer meets the cleanup age requirement/);
  assert.match(message, /can be queued again if they qualify later/);
  assert.doesNotMatch(message, /No media was deleted/);
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
  const deferred = formatDeletionDeferredReport([
    { Title: "Protected Movie", Type: "Movie", SkipCode: "in-progress" },
  ]);
  const removed = formatPendingRemovalReport([
    { Title: "Removed Movie", Type: "Movie", SkipCode: "too-new" },
  ]);

  for (const message of [pending, deletion, dryRun, failure, deferred, formatTestMessage()]) {
    assert.match(message, /^<b>🧽 Scrubarr - /);
    assert.equal(message.split("\n").at(-1), "🧼 <i>Scrubarr-dub-dub</i> 🧼");
  }
  assert.ok(pending.includes(specialTitle));
  assert.match(deletion, /Deletion Report/);
  assert.match(dryRun, /Preview Only Deletion Report/);
  assert.match(dryRun, /No media files were actually deleted/);
  assert.match(failure, /Deletion Failures/);
  assert.match(deferred, /Deletion Deferred for Safety/);
  assert.match(removed, /^<b>↩️ Scrubarr · Kept in library<\/b>/);
  assert.match(removed, /Too new for the current cleanup rules/);
  assert.equal(removed.split("\n").at(-1), "🧼 <i>Scrubarr-dub-dub</i> 🧼");
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

  const message = formatPendingNotification([
    { Title: specialTitle, Type: "Movie", DaysRemaining: 10 },
  ]);
  const result = await sendTelegramMessage(
    { BotToken: "123:token", ChatID: "-100123" },
    message,
    fakeFetch,
  );
  const payload = JSON.parse(requests[0].options.body);

  assert.equal(result.messageCount, 1);
  assert.equal(payload.chat_id, "-100123");
  assert.equal(payload.text, message);
  assert.ok(payload.text.includes("<u>10 days remaining:</u>"));
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

const bot = { BotToken: "123:token", ChatID: "-100123" };
const telegramAccepted = () => Response.json({ ok: true, result: { message_id: 1 } });

function connectionReset(message) {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(message), { code: "ECONNRESET" }),
  });
}

test("sender retries a reset before the TLS handshake, bounded to three attempts", async () => {
  for (const recover of [true, false]) {
    const attempted = [];
    const waits = [];
    const result = sendTelegramMessage(bot, "Report", async (_url, options) => {
      attempted.push(JSON.parse(options.body).text);
      if (recover && attempted.length === 3) return telegramAccepted();
      throw connectionReset("Client network socket disconnected before secure TLS connection was established");
    }, async (ms) => { waits.push(ms); });

    if (recover) {
      assert.deepEqual(await result, { messageCount: 1 });
    } else {
      await assert.rejects(result, /ECONNRESET/);
    }
    assert.deepEqual(attempted, ["Report", "Report", "Report"]);
    assert.deepEqual(waits, [500, 1000]);
  }
});

test("sender stops after unconfirmed delivery and preserves the count of confirmed parts", async () => {
  const attempted = [];
  const text = `${"a".repeat(4000)}\n${"b".repeat(4000)}\nthird part`;
  await assert.rejects(sendTelegramMessage(bot, text, async (_url, options) => {
    attempted.push(JSON.parse(options.body).text);
    if (attempted.length === 1) return telegramAccepted();
    throw connectionReset("read ECONNRESET");
  }, async () => assert.fail("ambiguous delivery must not be retried")), {
    message: /ECONNRESET.*delivery unconfirmed/,
    messageCount: 1,
  });
  assert.deepEqual(attempted, ["a".repeat(4000), `${"b".repeat(4000)}\nthird part`]);
});

test("sender retries only the throttled part and honors Telegram's retry interval", async () => {
  const attempted = [];
  const waits = [];
  const first = "a".repeat(4000);
  const second = "b".repeat(100);
  const result = await sendTelegramMessage(bot, `${first}\n${second}`, async (_url, options) => {
    attempted.push(JSON.parse(options.body).text);
    return attempted.length === 2
      ? Response.json({ ok: false, parameters: { retry_after: 2 } }, { status: 429 })
      : telegramAccepted();
  }, async (ms) => { waits.push(ms); });
  assert.equal(result.messageCount, 2);
  assert.deepEqual(attempted, [first, second, second]);
  assert.deepEqual(waits, [2000]);
});

test("sender reports persistent limits, authorization errors and unreadable replies without replay", async () => {
  for (const [makeResponse, message] of [
    [() => Response.json({ parameters: { retry_after: 60 } }, { status: 429 }), /HTTP 429/],
    [() => new Response(null, { status: 401 }), /HTTP 401/],
    [() => new Response("invalid JSON"), /delivery unconfirmed/],
    [() => new Response(null, { status: 503 }), /HTTP 503.*delivery unconfirmed/],
  ]) {
    let attempts = 0;
    await assert.rejects(sendTelegramMessage(bot, "Report", async () => {
      attempts += 1;
      return makeResponse();
    }, async () => assert.fail("response must not be retried")), message);
    assert.equal(attempts, 1);
  }
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
    DeletionSchedule: { DaysUntilDeletion: 20 },
  };
  const pending = [
    { Title: "Deleted Movie", Type: "Movie", MarkedDate: "2026-06-20", Deleted: true, Notified: [] },
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
  assert.deepEqual(result.pending[0].Notified, []);
  assert.deepEqual(result.pending[1].Notified, [20]);
  assert.deepEqual(result.pending[2].Notified, [20]);
  assert.deepEqual(result.pending[3].Notified, []);
  assert.equal(findDuePendingNotifications({
    settings,
    pending: result.pending,
    now: new Date("2026-06-20T04:00:00.000Z"),
    timezone: "Pacific/Auckland",
  }).length, 0);
});

test("failed reminder delivery reports the true due count without marking items as notified", async () => {
  const pending = [
    { Title: "Due Movie", Type: "Movie", MarkedDate: "2026-11-23", Notified: [] },
    { Title: "Due Series", Type: "Series", MarkedDate: "2026-11-23", Notified: [] },
  ];
  const result = await sendDuePendingNotifications({
    settings: { Telegram: { ...bot, Enabled: true }, DeletionSchedule: { DaysUntilDeletion: 20 } },
    pending,
    now: new Date("2026-11-22T23:00:00Z"),
    timezone: "Pacific/Auckland",
    sendMessage: async () => { throw new Error("connection reset; delivery unconfirmed"); },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.sent, false);
  assert.equal(result.due, 2);
  assert.equal(result.messageCount, 0);
  assert.match(result.message, /delivery unconfirmed/);
  assert.equal(result.pending, pending);
  assert.ok(pending.every((item) => item.Notified.length === 0));
});
