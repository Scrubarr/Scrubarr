const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const distIndex = path.join(root, "client", "dist", "index.html");
const captureDocsScreenshots = process.argv.includes("--capture-docs");
const docsScreenshotDirectory = path.join(root, "docs", "screenshots");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Scrubarr exited early.\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const data = await response.json();
      if (data.status === "ok") {
        return;
      }
    } catch {
      // Keep polling until the server is ready or the child exits.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Scrubarr health.\n${output()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist|browserType.launch/.test(error.message)) {
      throw error;
    }
    return chromium.launch({ channel: "chrome" });
  }
}

async function startMockEmbyServer() {
  const port = await getFreePort();
  const libraries = [
    { ItemId: "movies", Name: "Movies", CollectionType: "movies" },
    { ItemId: "shows", Name: "TV Shows", CollectionType: "tvshows" },
  ];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const sendJson = (body) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (
      url.pathname === "/Library/VirtualFolders" ||
      url.pathname === "/Library/VirtualFolders/Query"
    ) {
      sendJson(libraries);
      return;
    }

    if (url.pathname === "/Users") {
      sendJson([{ Id: "browser-user", Name: "Browser Test User" }]);
      return;
    }

    if (url.pathname === "/Items") {
      const parentId = url.searchParams.get("ParentId");
      const includeTypes = url.searchParams.get("IncludeItemTypes");
      if (parentId === "movies" && includeTypes === "Movie") {
        sendJson({
          TotalRecordCount: 2,
          Items: [
            {
              Id: "mock-movie-1",
              Name: "Synthetic Cinema",
              Type: "Movie",
              Path: "C:\\Media\\Movies\\Synthetic Cinema.mkv",
            },
            {
              Id: "mock-movie-2",
              Name: "Placeholder Picture",
              Type: "Movie",
              Path: "C:\\Media\\Movies\\Placeholder Picture.mkv",
            },
          ],
        });
        return;
      }
      if (parentId === "shows" && includeTypes === "Series") {
        sendJson({
          TotalRecordCount: 1,
          Items: [
            {
              Id: "mock-series-1",
              Name: "Test Pattern",
              Type: "Series",
              Path: "C:\\Media\\Shows\\Test Pattern",
            },
          ],
        });
        return;
      }
      if (parentId === "shows" && includeTypes === "Episode") {
        sendJson({ TotalRecordCount: 12, Items: [] });
        return;
      }
      sendJson({ TotalRecordCount: 0, Items: [] });
      return;
    }

    sendJson({});
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function captureDocumentationScreenshot(page, name) {
  if (!captureDocsScreenshots) {
    return;
  }

  await fs.mkdir(docsScreenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(docsScreenshotDirectory, `${name}.png`),
    fullPage: true,
  });
}

async function seedData(dataDir, embyUrl) {
  const cleanRun = {
    id: "browser-clean-latest",
    source: "scheduler",
    type: "scan",
    status: "success",
    startedAt: "2026-09-08T12:00:00.000Z",
    completedAt: "2026-09-08T12:00:08.000Z",
    readOnly: true,
    scanned: 24,
    candidates: 2,
    candidateMovies: 1,
    candidateSeries: 1,
    queued: 2,
    queuedMovies: 1,
    queuedSeries: 1,
    warnings: [],
    issues: [],
    librarySync: {
      status: "success",
      enabled: true,
      pending: 2,
      refreshed: true,
      scanRequested: true,
      scanWarnings: [],
    },
    notifications: {
      status: "sent",
      enabled: true,
      sent: true,
      due: 2,
      messageCount: 1,
    },
    cleanup: {
      status: "success",
      dryRun: true,
      expired: 0,
      deleted: 0,
      failed: 0,
      deferred: 0,
    },
  };
  const warningRun = {
    ...cleanRun,
    id: "browser-warning",
    startedAt: "2026-09-08T11:00:00.000Z",
    completedAt: "2026-09-08T11:00:07.000Z",
    scanned: 18,
    candidates: 1,
    queued: 1,
    warnings: ["Display fixture: the media-server scan was still in progress."],
  };
  const partialRun = {
    ...cleanRun,
    id: "browser-partial",
    status: "partial",
    startedAt: "2026-09-08T10:00:00.000Z",
    completedAt: "2026-09-08T10:00:09.000Z",
    issues: [
      { key: "libraries", label: "Display fixture: Leaving Soon library sync needs attention." },
    ],
    warnings: [],
    librarySync: {
      ...cleanRun.librarySync,
      status: "partial",
      refreshed: false,
      scanWarnings: ["Display fixture: one Leaving Soon library was not refreshed."],
    },
  };
  const deferredRun = {
    id: "browser-deletion-deferral",
    source: "scheduler",
    type: "deletion",
    status: "success",
    startedAt: "2026-09-08T09:00:00.000Z",
    completedAt: "2026-09-08T09:00:04.000Z",
    dryRun: false,
    expiredTotal: 1,
    deletedTotal: 0,
    failedTotal: 0,
    deferredTotal: 1,
    deletedItems: [],
    failedItems: [],
    deferredItems: [
      {
        ItemId: "deferred-series-1",
        Title: "Display Fixture Deferred Series",
        Type: "Series",
        Year: 2022,
        SkipCode: "media-in-use",
        SkipMessage:
          "Deletion deferred for safety because the item is currently playing or paused.",
      },
    ],
    deferralTelegram: {
      enabled: true,
      sent: true,
      messageCount: 1,
      message: "Sent Telegram report for 1 item(s).",
    },
  };
  const malformedLegacyRun = {
    source: "legacy-import",
    type: "scan",
    completedAt: "not-a-timestamp",
    scanned: "unknown",
    candidates: null,
    warnings: "legacy warning stored as text",
  };
  const olderCleanRun = {
    ...cleanRun,
    id: "browser-clean-middle",
    startedAt: "2026-09-07T12:00:00.000Z",
    completedAt: "2026-09-07T12:00:05.000Z",
    scanned: 12,
    candidates: 0,
    queued: 0,
  };
  const failedRun = {
    id: "browser-failed-deep-link",
    source: "scheduler",
    type: "scan",
    status: "failed",
    startedAt: "2026-09-06T12:00:00.000Z",
    completedAt: "2026-09-06T12:00:03.000Z",
    readOnly: true,
    message: "Display fixture: Radarr could not be reached.",
    issues: [
      { key: "scan", label: "Display fixture: scheduled scan failed before queue commit." },
    ],
  };
  const oldestCleanRun = {
    ...cleanRun,
    id: "browser-clean-oldest",
    startedAt: "2026-09-05T12:00:00.000Z",
    completedAt: "2026-09-05T12:00:06.000Z",
    scanned: 9,
    candidates: 0,
    queued: 0,
  };
  const runLog = [
    cleanRun,
    warningRun,
    partialRun,
    deferredRun,
    malformedLegacyRun,
    olderCleanRun,
    failedRun,
    oldestCleanRun,
  ];

  await fs.writeFile(
    path.join(dataDir, "config.json"),
    `${JSON.stringify(
      {
        MediaServer: {
          Provider: "emby",
          Locked: true,
        },
        Emby: {
          ServerUrl: embyUrl,
          ApiKey: "browser-regression-key",
          UserIds: [],
          SearchLibraries: ["Movies", "TV Shows"],
        },
        CleanupRules: { DryRun: true },
        CleanupFilters: {
          Movies: {
            YearFrom: null,
            YearTo: null,
            IncludeGenres: [
              "Action",
              "Adventure",
              "Animation",
              "Children",
              "Family",
              "Fantasy",
              "Horror",
            ],
            ExcludeGenres: [],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dataDir, "ToDelete.json"),
    `${JSON.stringify(
      [
        {
          ItemId: "pending-movie-1",
          Title: "Browser Smoke Movie",
          Type: "Movie",
          Year: 2020,
          Arr: "Radarr",
          ArrId: 101,
          HasPrimaryImage: false,
          MarkedDate: "2026-06-20",
          Reason: "Last played 400 days ago (365+ days)",
          DateSource: "emby-last-played",
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dataDir, "Exclusions.json"),
    `${JSON.stringify(
      [
        {
          ItemId: "excluded-series-1",
          Title: "Browser Smoke Series",
          Type: "Series",
          Year: 2021,
          Arr: "Sonarr",
          ArrId: 202,
          HasPrimaryImage: false,
        },
      ],
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dataDir, "RunLog.json"),
    `${JSON.stringify(runLog, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(dataDir, "Scheduler.json"),
    `${JSON.stringify(
      {
        config: { enabled: false },
        lastRun: {
          ...warningRun,
          librarySync: { ...warningRun.librarySync },
          notifications: { ...warningRun.notifications },
          cleanup: { ...warningRun.cleanup },
        },
        lastScheduledDate: null,
        runAlert: null,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function assertNoBlankPage(page, label) {
  await page.locator("body").waitFor({ state: "visible" });
  const bodyText = await page.locator("body").innerText();
  assert(bodyText.trim().length > 0, `${label} rendered a blank page`);
  const rootChildren = await page.locator("#root > *").count();
  assert(rootChildren > 0, `${label} did not mount the React app`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  const widest = Math.max(overflow.body, overflow.document);
  assert(
    widest <= overflow.viewport + 2,
    `${label} overflowed horizontally: ${widest}px > ${overflow.viewport}px`,
  );
}

async function clickByRole(page, role, options) {
  await page.getByRole(role, options).click();
}

function logsRunCards(page) {
  return page.locator('section[aria-labelledby="run-history-heading"] article');
}

function logsPicker(page, label) {
  return page
    .getByText(label, { exact: true })
    .locator("..")
    .locator("details");
}

async function waitForLogsCardCount(page, expected) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(
        'section[aria-labelledby="run-history-heading"] article',
      ).length === count,
    expected,
  );
}

async function chooseLogsOption(page, label, option, { keyboard = false } = {}) {
  const picker = logsPicker(page, label);
  const summary = picker.locator("summary");
  if (keyboard) {
    if (!(await picker.evaluate((details) => details.open))) {
      await summary.focus();
      await page.keyboard.press("Enter");
    }
    assert(
      await picker.evaluate((details) => details.open),
      `${label} filter must open from the keyboard`,
    );
    const choice = picker.getByRole("button", { name: option, exact: true });
    await choice.focus();
    await page.keyboard.press("Enter");
  } else {
    if (!(await picker.evaluate((details) => details.open))) {
      await summary.click();
    }
    await picker.evaluate((details) => {
      details.open = true;
    });
    const choice = picker.locator("button").filter({ hasText: new RegExp(`^${option}$`) });
    await choice.evaluate((button) => button.click());
  }
}

async function assertDefaultLogsPage(page, label) {
  await page.getByRole("heading", { name: "Logs", exact: true }).waitFor();
  const recentActivity = page
    .getByText("Recent activity", { exact: true })
    .locator("xpath=ancestor::section");
  const activityLabels = await recentActivity.locator("div.grid > * > p:first-child").allTextContents();
  assert(
    JSON.stringify(activityLabels.map((value) => value.trim())) ===
      JSON.stringify(["Failed / partial", "Warnings", "Logged entries", "Candidates seen"]),
    label + " must show actionable recent activity before informational totals",
  );
  await waitForLogsCardCount(page, 5);
  const cards = logsRunCards(page);
  assert(
    await cards.getByRole("button", { name: "View details", exact: true }).count() === 5,
    label + " must show five collapsed run entries by default",
  );
  assert(
    await cards.getByRole("button", { name: "Hide details", exact: true }).count() === 0,
    label + " must not expand run entries by default",
  );
  await page.getByText("Status unavailable", { exact: true }).waitFor();
  assert(
    await page.getByRole("button", { name: /Logged entries/ }).getAttribute("aria-pressed") === "true",
    label + " must identify the active all-outcomes filter",
  );
}

async function runLogsDesktopChecks(baseUrl, browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(7000);

  await page.goto(baseUrl + "/logs", { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Logs");
  await assertDefaultLogsPage(page, "Desktop logs");
  await captureDocumentationScreenshot(page, "logs");

  await page.getByRole("button", { name: /^Warnings / }).click();
  await page.waitForURL((url) => url.searchParams.get("result") === "warnings");
  await waitForLogsCardCount(page, 3);
  await page.waitForFunction(() => document.activeElement?.id === "run-history-heading");
  assert(
    await page.getByRole("button", { name: /^Warnings / }).getAttribute("aria-pressed") === "true",
    "Warnings summary must identify itself as the active filter",
  );
  const warningCards = logsRunCards(page);
  await warningCards.getByText("Completed with warnings", { exact: true }).waitFor();
  await warningCards.getByText("Partially completed", { exact: true }).waitFor();
  await warningCards.getByText("Failed", { exact: true }).waitFor();

  const warningCard = page
    .getByText("Completed with warnings", { exact: true })
    .locator("xpath=ancestor::article");
  const warningToggle = warningCard.getByRole("button", {
    name: "View details",
    exact: true,
  });
  await warningToggle.focus();
  await page.keyboard.press("Enter");
  const expandedWarningToggle = warningCard.getByRole("button", {
    name: "Hide details",
    exact: true,
  });
  await expandedWarningToggle.waitFor();
  assert(
    await expandedWarningToggle.getAttribute("aria-expanded") === "true",
    "Run details toggle must expand from the keyboard",
  );
  await warningCard.getByText("Problems recorded", { exact: true }).waitFor();
  await expandedWarningToggle.press("Space");

  await chooseLogsOption(page, "Show", "Failed or partial", { keyboard: true });
  await page.waitForURL((url) => url.searchParams.get("result") === "problems");
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("result") === "warnings");
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("result") === "problems");
  await waitForLogsCardCount(page, 2);
  await page.waitForFunction(() => (
    [...document.querySelectorAll('section[aria-labelledby="run-history-heading"] article')]
      .filter((card) => card.innerText.includes("Partially completed")).length === 1
  ));
  const problemCards = logsRunCards(page);
  const partialCount = await problemCards.getByText("Partially completed", { exact: true }).count();
  assert(
    partialCount === 1,
    `Problem filter must include partial entries but not protected deferrals; found ${partialCount}`,
  );
  assert(
    await problemCards.getByText("Failed", { exact: true }).count() === 1,
    "Problem filter must include failed entries",
  );
  assert(
    await problemCards.getByRole("heading", { name: "Scheduled deletion check", exact: true }).count() === 0,
    "Problem filter must not classify an intentional safety deferral as a failed or partial run",
  );

  await chooseLogsOption(page, "Show", "All entries");
  await page.waitForURL((url) => !url.searchParams.has("result"));
  await waitForLogsCardCount(page, 5);
  const deferredCard = page
    .getByRole("heading", { name: "Scheduled deletion check", exact: true })
    .locator("xpath=ancestor::article");
  await deferredCard.getByText("Completed with protected items", { exact: true }).waitFor();
  await deferredCard
    .getByText("1 due, 0 deleted, 0 removed from pending, 1 deferred, 0 failed", { exact: true })
    .waitFor();
  await deferredCard
    .getByRole("button", { name: "View details", exact: true })
    .click();
  await deferredCard.getByText("Deferred media", { exact: true }).waitFor();
  await deferredCard
    .getByText(/currently playing or paused/i)
    .waitFor();
  await deferredCard.getByText("Safety deferral report", { exact: true }).waitFor();
  const dateFilterToggle = page.getByRole("button", { name: "Filter by date", exact: true });
  await dateFilterToggle.click();
  const hideDateFilter = page.getByRole("button", { name: "Hide date filter", exact: true });
  await hideDateFilter.waitFor();
  await hideDateFilter.click();
  await page.getByLabel("From").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Filter by date", exact: true }).click();
  const dateFilter = page.locator("#log-date-filter-fields");
  await dateFilter.getByLabel("From").fill("2026-09-08");
  await dateFilter.getByLabel("To").fill("2026-09-08");
  await dateFilter.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("from") === "2026-09-08" && url.searchParams.get("to") === "2026-09-08");
  await waitForLogsCardCount(page, 4);
  await page.getByRole("button", { name: "Filter by date", exact: true }).click();
  await dateFilter.getByRole("button", { name: "Clear", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("from") && !url.searchParams.has("to"));
  await waitForLogsCardCount(page, 5);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  await waitForLogsCardCount(page, 3);
  await page
    .getByText("Showing 6-8 of 8 matching entries", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("page"));
  await waitForLogsCardCount(page, 5);

  await page.goto(baseUrl + "/logs?run=browser-failed-deep-link", {
    waitUntil: "networkidle",
  });
  const deepLinkedCard = page.locator("#run-browser-failed-deep-link");
  await deepLinkedCard.waitFor();
  await deepLinkedCard
    .getByRole("button", { name: "Hide details", exact: true })
    .waitFor();
  await deepLinkedCard
    .getByText("Display fixture: Radarr could not be reached.", { exact: true })
    .waitFor();
  assert(
    new URL(page.url()).searchParams.get("run") === "browser-failed-deep-link",
    "Deep link must retain the exact requested run ID",
  );
  assert(
    new URL(page.url()).searchParams.get("page") === "2",
    "Deep link must reveal a retained run on its actual page",
  );
  await page.waitForFunction(
    () => document.activeElement?.id === "run-browser-failed-deep-link",
  );

  await page.close();
}

async function runLogsRefreshFailureChecks(baseUrl, browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(7000);
  let requests = 0;
  await page.route(/\/api\/logs\?limit=200$/, async (route) => {
    requests += 1;
    if (requests === 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Display fixture: refresh failed." }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(baseUrl + "/logs", { waitUntil: "networkidle" });
  await assertDefaultLogsPage(page, "Refresh-error logs");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Display fixture: refresh failed.", { exact: true }).waitFor();
  await waitForLogsCardCount(page, 5);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByText("Display fixture: refresh failed.", { exact: true }).waitFor({ state: "hidden" });
  await waitForLogsCardCount(page, 5);
  await page.close();
}

async function runLogsMobileChecks(baseUrl, browser, width) {
  const page = await browser.newPage({
    viewport: { width, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(7000);
  const label = "Logs at " + width + "px";

  await page.goto(baseUrl + "/logs", { waitUntil: "networkidle" });
  await assertNoBlankPage(page, label);
  await assertDefaultLogsPage(page, label);
  await assertNoHorizontalOverflow(page, label);

  const showPicker = logsPicker(page, "Show");
  await showPicker.locator("summary").tap();
  await showPicker
    .getByRole("button", { name: "With warnings", exact: true })
    .waitFor();
  await assertNoHorizontalOverflow(page, label + " open status filter");
  await showPicker
    .getByRole("button", { name: "With warnings", exact: true })
    .tap();
  await waitForLogsCardCount(page, 3);
  await assertNoHorizontalOverflow(page, label + " warning results");

  await chooseLogsOption(page, "Show", "Failed or partial");
  await waitForLogsCardCount(page, 2);

  await chooseLogsOption(page, "Show", "All entries");
  await waitForLogsCardCount(page, 5);
  const deferredCard = page
    .getByRole("heading", { name: "Scheduled deletion check", exact: true })
    .locator("xpath=ancestor::article");
  await deferredCard.getByText("Completed with protected items", { exact: true }).waitFor();
  await deferredCard
    .getByRole("button", { name: "View details", exact: true })
    .tap();
  await deferredCard.getByText("Deferred media", { exact: true }).waitFor();
  await assertNoHorizontalOverflow(page, label + " expanded protected run");
  await page.getByRole("button", { name: "Next", exact: true }).tap();
  await waitForLogsCardCount(page, 3);
  await assertNoHorizontalOverflow(page, label + " second page");

  await page.goto(baseUrl + "/logs?run=browser-failed-deep-link", {
    waitUntil: "networkidle",
  });
  const deepLinkedCard = page.locator("#run-browser-failed-deep-link");
  await deepLinkedCard.waitFor();
  await deepLinkedCard
    .getByRole("button", { name: "Hide details", exact: true })
    .waitFor();
  await assertNoHorizontalOverflow(page, label + " deep-linked failure");

  await page.close();
}

async function runDesktopChecks(baseUrl, browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(7000);

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Dashboard");
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.getByPlaceholder(/Search movies and series/i).waitFor();
  await page.getByText("Browser Smoke Movie").waitFor();
  await captureDocumentationScreenshot(page, "dashboard");
  await clickByRole(page, "button", { name: /^Remove$/ });
  await page.getByRole("heading", { name: "Remove from pending?" }).waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Settings");
  await page.getByPlaceholder(/Search movies and series/i).waitFor();
  await clickByRole(page, "button", { name: "Save settings" });
  await page.getByText("Settings saved.").waitFor();

  await page.goto(`${baseUrl}/scheduler`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Scheduler");
  await clickByRole(page, "button", { name: "Save schedule" });
  await page.getByText("Schedule saved.").waitFor();

  await page.goto(`${baseUrl}/cleanup`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Cleanup Rules");
  await page.getByText("Rule summary").waitFor();
  await captureDocumentationScreenshot(page, "cleanup-rules");
  await clickByRole(page, "button", { name: "Preview scan" });
  await page.waitForFunction(
    () => !document.body.innerText.includes("Scanning configured libraries..."),
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Preview scan" }).waitFor();

  await page.goto(`${baseUrl}/exclusions`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Exclusions");
  await page.getByText("Browser Smoke Series").waitFor();
  await captureDocumentationScreenshot(page, "exclusions");
  await clickByRole(page, "button", { name: "Remove Browser Smoke Series" });
  await page.getByRole("heading", { name: "Remove exclusion?" }).waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${baseUrl}/safety`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Safety");
  await page.getByRole("heading", { name: "Safety", exact: true }).waitFor();
  await captureDocumentationScreenshot(page, "safety");

  await page.close();
}

async function runMobileChecks(baseUrl, browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(7000);

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Mobile dashboard");
  await assertNoHorizontalOverflow(page, "Mobile dashboard");
  await clickByRole(page, "button", { name: "Open navigation" });
  await page.locator(".mobile-navigation").waitFor();
  await page.getByRole("link", { name: "Cleanup Rules" }).click();
  await page.getByRole("heading", { name: "Cleanup Rules" }).waitFor();
  await assertNoHorizontalOverflow(page, "Mobile cleanup rules");

  await page.getByText("7 selected genres.").waitFor();
  const genrePicker = page
    .locator("details")
    .filter({ hasText: "Clear selection" })
    .first();
  await genrePicker.locator("summary").click();
  await genrePicker.getByText("Clear selection").waitFor();
  await assertNoHorizontalOverflow(page, "Open mobile genre picker");
  await page.mouse.click(10, 10);
  await genrePicker.getByText("Clear selection").waitFor({ state: "hidden" });

  const firstHelp = page.locator('button[aria-label]').filter({ hasText: "?" }).first();
  await firstHelp.tap();
  await assertNoHorizontalOverflow(page, "Mobile help tooltip");
  await page.mouse.click(10, 10);

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.getByText("Browser Smoke Movie").waitFor();
  await page
    .locator('button[aria-label^="Show why"]')
    .first()
    .tap();
  await page.getByText("Qualification reasons").waitFor();
  await assertNoHorizontalOverflow(page, "Mobile qualification popover");

  await page.close();
}

async function runPendingActionChecks(baseUrl, browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(7000);
  let pending = Array.from({ length: 16 }, (_, index) => ({
    ItemId: `sort-${index}`, Title: `Sort Film ${index + 1}`, Type: "Movie",
    Year: 2020, MarkedDate: "2099-01-01", HasPrimaryImage: false,
  }));
  await page.route(/\/api\/pending$/, (route) => route.fulfill({ json: pending }));
  await page.route(/\/api\/exclusions$/, (route) => route.fulfill({ json: pending }));
  let releaseRemoval;
  const removalWait = new Promise((resolve) => { releaseRemoval = resolve; });
  await page.route("**/api/pending/sort-7/exclude", async (route) => {
    await removalWait;
    pending = pending.filter((item) => item.ItemId !== "sort-7");
    await route.fulfill({ json: { removed: true } });
  });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.locator("summary").filter({ hasText: "Due soonest" }).click();
  await page.getByRole("button", { name: "Title Z-A", exact: true }).click();
  const titles = await page.locator("article.dashboard-media-card h3").allTextContents();
  assert(titles[0] === "Sort Film 16" && titles.at(-1) === "Sort Film 1", "Pending Z-A must use numeric title ordering");
  const card = page.locator("article.dashboard-media-card").filter({ has: page.getByRole("heading", { name: "Sort Film 8", exact: true }) });
  await card.getByRole("button", { name: "Remove + exclude", exact: true }).click();
  await page.getByRole("heading", { name: "Remove and exclude?", exact: true }).waitFor();
  await page.locator("body > div.fixed").getByRole("button", { name: "Remove + exclude", exact: true }).click();
  await card.getByRole("button", { name: "Removing and syncing...", exact: true }).waitFor();
  assert(await card.getByRole("button", { name: "Remove", exact: true }).locator(".animate-spin").count() === 0, "Remove must not spin for Remove + exclude");
  assert(await card.getByRole("button", { name: "Removing and syncing...", exact: true }).locator(".animate-spin").count() === 1, "Clicked action must own its spinner");
  const before = await page.evaluate(() => window.scrollY);
  releaseRemoval();
  await card.waitFor({ state: "detached" });
  await page.getByText("Sort Film 8 was removed from pending and added to exclusions.", { exact: true }).waitFor();
  const after = await page.evaluate(() => window.scrollY);
  assert(after >= before - 450, `Pending refresh jumped upward: ${before} -> ${after}`);
  await page.goto(`${baseUrl}/exclusions`, { waitUntil: "networkidle" });
  await page.locator("summary").filter({ hasText: "Title A-Z" }).click();
  await page.getByRole("button", { name: "Title Z-A", exact: true }).click();
  const excludedTitles = await page.locator("h3").allTextContents();
  assert(excludedTitles[0] === "Sort Film 16" && excludedTitles.at(-1) === "Sort Film 1", "Exclusion Z-A must use numeric title ordering");
  await page.goto(`${baseUrl}/cleanup`, { waitUntil: "networkidle" });
  assert(await page.getByText("Preview only mode is", { exact: false }).count() === 0, "Duplicate Preview explanation must be removed");
  const previewWarning = page.getByText("Enabled: Scrubarr can scan, queue, and send notifications, but will not delete media.", { exact: true });
  await previewWarning.waitFor();
  const previewCheckbox = page.getByRole("checkbox", { name: "Preview only mode" });
  const protectedCheckbox = page.getByRole("checkbox", { name: "Protect in-progress media" });
  const tagCheckbox = page.getByRole("checkbox", { name: "Tag pending items in Radarr/Sonarr" });
  const checkboxSizes = await Promise.all(
    [previewCheckbox, protectedCheckbox, tagCheckbox].map((checkbox) =>
      checkbox.evaluate((input) => ({ width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height })),
    ),
  );
  assert(
    checkboxSizes.every(({ width, height }) => width === 16 && height === 16),
    `Queue and safety checkboxes must remain 16px square: ${JSON.stringify(checkboxSizes)}`,
  );
  await tagCheckbox.check();
  const protectNote = page.getByText("Recommended if people often pause and continue media later. Abandoned Continue Watching items can still qualify after the configured age.", { exact: true });
  const tagNote = page.getByText("Scrubarr will try to add and remove this tag as pending items change.", { exact: true });
  const [protectColor, tagColor, previewColor] = await Promise.all(
    [protectNote, tagNote, previewWarning].map((label) => label.evaluate((element) => getComputedStyle(element).color)),
  );
  assert(protectColor === tagColor && protectColor !== previewColor, "Safety notes must be neutral while Preview only retains its warning color");
  await page.close();
}

async function main() {
  await fs.access(distIndex).catch(() => {
    throw new Error(
      "Client build not found. Run `npm run build` before `npm run test:ui:browser`.",
    );
  });

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-ui-browser-"));
  const dataDir = path.join(tempRoot, "data");
  const logDir = path.join(tempRoot, "logs");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const mockEmby = await startMockEmbyServer();
  await seedData(dataDir, mockEmby.baseUrl);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    SCRUBARR_HOST: "127.0.0.1",
    SCRUBARR_PORT: String(port),
    SCRUBARR_DATA_DIR: dataDir,
    SCRUBARR_LOG_DIR: logDir,
    SCRUBARR_UPDATE_MANIFEST_URL: "",
  };

  let stdout = "";
  let stderr = "";
  const child = spawn(process.execPath, ["server/src/index.js"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const output = () => [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  let browser;
  try {
    await waitForHealth(baseUrl, child, output);
    browser = await launchBrowser();
    await runLogsDesktopChecks(baseUrl, browser);
    await runLogsRefreshFailureChecks(baseUrl, browser);
    await runLogsMobileChecks(baseUrl, browser, 390);
    await runLogsMobileChecks(baseUrl, browser, 326);
    await runDesktopChecks(baseUrl, browser);
    await runMobileChecks(baseUrl, browser);
    await runPendingActionChecks(baseUrl, browser);
    console.log(`UI browser regression test passed at ${baseUrl}`);
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
    await mockEmby.close();
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
