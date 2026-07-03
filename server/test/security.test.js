import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDefaultSettings } from "../src/config/settings.js";
import { hashPassword } from "../src/services/auth.js";

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

async function removeDirectory(directory) {
  await fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

function runtimeFor(directory) {
  return {
    projectRoot: directory,
    host: "127.0.0.1",
    port: 0,
    timezone: "UTC",
    dataDirectory: directory,
    logDirectory: path.join(directory, "logs"),
    configFile: path.join(directory, "config.json"),
    pendingFile: path.join(directory, "ToDelete.json"),
    exclusionsFile: path.join(directory, "Exclusions.json"),
    inProgressFile: path.join(directory, "InProgress.json"),
    schedulerFile: path.join(directory, "Scheduler.json"),
    runLogFile: path.join(directory, "RunLog.json"),
    appLogFile: path.join(directory, "logs", "Scrubarr.log"),
    deletedDirectory: path.join(directory, "deleted"),
    clientDistDirectory: path.join(directory, "missing-client"),
    updateManifestUrl: "",
  };
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

test("public health stays public while detailed status follows basic auth", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-security-"));
  const runtime = runtimeFor(directory);
  const settings = createDefaultSettings(runtime);
  settings.Auth.Enabled = true;
  settings.Auth.Username = "admin";
  settings.Auth.PasswordHash = hashPassword("secret");
  await fs.writeFile(runtime.configFile, JSON.stringify(settings), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("x-frame-options"), "DENY");

    const statusWithoutAuth = await fetch(
      `http://127.0.0.1:${port}/api/health/status`,
    );
    assert.equal(statusWithoutAuth.status, 401);
    assert.deepEqual(await statusWithoutAuth.json(), {
      error: "authentication_required",
      message: "Please sign in to Scrubarr.",
    });

    const statusWithMalformedCookie = await fetch(
      `http://127.0.0.1:${port}/api/health/status`,
      { headers: { Cookie: "scrubarr_auth=%" } },
    );
    assert.equal(statusWithMalformedCookie.status, 401);

    const pageWithoutAuth = await fetch(`http://127.0.0.1:${port}/settings`, {
      headers: { Accept: "text/html" },
    });
    const loginHtml = await pageWithoutAuth.text();
    assert.equal(pageWithoutAuth.status, 200);
    assert.match(loginHtml, /Scrubarr/);
    assert.match(loginHtml, /Sign in/);

    const badLogin = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "admin",
        password: "wrong",
        next: "/settings",
      }),
    });
    assert.equal(badLogin.status, 401);
    assert.match(await badLogin.text(), /Username or password incorrect/);

    const goodLogin = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "admin",
        password: "secret",
        next: "/settings",
      }),
      redirect: "manual",
    });
    assert.equal(goodLogin.status, 303);
    const sessionCookie = goodLogin.headers.get("set-cookie");
    assert.match(sessionCookie, /scrubarr_auth=/);
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Strict/);

    const statusWithCookie = await fetch(
      `http://127.0.0.1:${port}/api/health/status`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.equal(statusWithCookie.status, 200);

    const statusWithAuth = await fetch(
      `http://127.0.0.1:${port}/api/health/status`,
      { headers: { Authorization: basicAuth("admin", "secret") } },
    );
    assert.equal(statusWithAuth.status, 200);
  } finally {
    await close(server);
    await removeDirectory(directory);
  }
});

test("state changing requests reject a foreign browser origin", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-security-"));
  const runtime = runtimeFor(directory);
  await fs.writeFile(runtime.configFile, JSON.stringify(createDefaultSettings(runtime)), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "invalid_origin" });
  } finally {
    await close(server);
    await removeDirectory(directory);
  }
});

test("json request bodies reject unsafe object keys", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-security-"));
  const runtime = runtimeFor(directory);
  await fs.writeFile(runtime.configFile, JSON.stringify(createDefaultSettings(runtime)), "utf8");

  const server = http.createServer(createApp(runtime));
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: '{"__proto__":{"polluted":true}}',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_request",
      message: "Request body contains an unsupported object key.",
    });
    assert.equal(Object.prototype.polluted, undefined);
  } finally {
    await close(server);
    await removeDirectory(directory);
  }
});
