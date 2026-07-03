const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const distIndex = path.join(root, "client", "dist", "index.html");

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

async function seedData(dataDir) {
  await fs.writeFile(
    path.join(dataDir, "config.json"),
    `${JSON.stringify(
      {
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

async function runDesktopChecks(baseUrl, browser) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(7000);

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Dashboard");
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.getByPlaceholder(/Search movies and series/i).waitFor();
  await page.getByText("Browser Smoke Movie").waitFor();
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
  await clickByRole(page, "button", { name: "Preview scan" });
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return (
      text.includes("Preview complete") ||
      text.includes("Preview failed") ||
      text.includes("Emby URL")
    );
  });

  await page.goto(`${baseUrl}/exclusions`, { waitUntil: "networkidle" });
  await assertNoBlankPage(page, "Exclusions");
  await page.getByText("Browser Smoke Series").waitFor();
  await clickByRole(page, "button", { name: "Remove Browser Smoke Series" });
  await page.getByRole("heading", { name: "Remove exclusion?" }).waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();

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
    .filter({ hasText: "Action, Adventure" })
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
  await seedData(dataDir);

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
    await runDesktopChecks(baseUrl, browser);
    await runMobileChecks(baseUrl, browser);
    console.log(`UI browser regression test passed at ${baseUrl}`);
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
