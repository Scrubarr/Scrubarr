const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

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

async function request(url, { expectJson = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`);
    }
    if (!expectJson) {
      return { response, text };
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${url} did not return valid JSON: ${error.message}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Scrubarr exited early.\n${output()}`);
    }
    try {
      const health = await request(`${baseUrl}/api/health`, { expectJson: true });
      if (health.status === "ok") {
        return;
      }
    } catch {
      // Keep polling until the server is ready or the child exits.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Scrubarr health.\n${output()}`);
}

function extractAssetPaths(indexHtml) {
  const assets = new Set();
  for (const match of indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const assetPath = match[1];
    if (
      assetPath.startsWith("/assets/") ||
      assetPath.startsWith("/favicon") ||
      assetPath === "/apple-touch-icon.png" ||
      assetPath === "/icon-192.png" ||
      assetPath === "/icon-512.png" ||
      assetPath === "/site.webmanifest"
    ) {
      assets.add(assetPath);
    }
  }
  assets.add("/favicon.ico");
  return [...assets];
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

async function main() {
  await fs.access(distIndex).catch(() => {
    throw new Error("Client build not found. Run `npm run build` before `npm run test:ui`.");
  });

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-ui-smoke-"));
  const dataDir = path.join(tempRoot, "data");
  const logDir = path.join(tempRoot, "logs");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });

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

  try {
    await waitForHealth(baseUrl, child, output);

    const routes = [
      "/",
      "/cleanup",
      "/exclusions",
      "/scheduler",
      "/logs",
      "/settings",
      "/safety",
    ];

    let indexHtml = "";
    for (const route of routes) {
      const { response, text } = await request(`${baseUrl}${route}`);
      assert(
        response.headers.get("content-type")?.includes("text/html"),
        `${route} did not return HTML`,
      );
      assert(text.includes('<div id="root"></div>'), `${route} did not return the SPA root`);
      if (route === "/") {
        indexHtml = text;
      }
    }

    for (const assetPath of extractAssetPaths(indexHtml)) {
      await request(`${baseUrl}${assetPath}`);
    }

    const apiChecks = [
      ["/api/health/status", (data) => data.scheduler && data.mode],
      ["/api/settings", (data) => data.Emby && data.CleanupRules],
      ["/api/scheduler", (data) => data.config && "enabled" in data.config],
      ["/api/pending", (data) => Array.isArray(data)],
      ["/api/exclusions", (data) => Array.isArray(data)],
      ["/api/logs?limit=1", (data) => Array.isArray(data.entries)],
    ];

    for (const [apiPath, validate] of apiChecks) {
      const data = await request(`${baseUrl}${apiPath}`, { expectJson: true });
      assert(validate(data), `${apiPath} returned an unexpected shape`);
    }

    for (const exportType of ["run", "app"]) {
      const { response, text } = await request(
        `${baseUrl}/api/logs/export?type=${exportType}`,
      );
      assert(
        response.headers.get("content-type")?.includes("text/plain"),
        `${exportType} log export did not return text/plain`,
      );
      assert(
        response.headers.get("content-disposition")?.includes(".log"),
        `${exportType} log export did not include a .log download name`,
      );
      assert(text.length > 0, `${exportType} log export was empty`);
    }

    console.log(`UI smoke test passed at ${baseUrl}`);
  } finally {
    await stopChild(child);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
