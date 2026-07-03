import crypto from "node:crypto";
import { mergeSettings } from "../config/settings.js";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;
const COOKIE_NAME = "scrubarr_auth";
const SESSION_DURATION_SECONDS = 12 * 60 * 60;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MILLISECONDS = 60 * 1000;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [prefix, salt, hash] = String(storedHash || "").split("$");
  if (prefix !== HASH_PREFIX || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
}

function parseBasicAuth(header) {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const rawPart of String(header || "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;

    const separator = part.indexOf("=");
    const rawName = separator < 0 ? part : part.slice(0, separator);
    const rawValue = separator < 0 ? "" : part.slice(separator + 1);
    try {
      cookies[decodeURIComponent(rawName)] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed browser cookies instead of turning auth checks into 500s.
    }
  }
  return cookies;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function sign(value, secret) {
  return crypto
    .createHmac("sha256", String(secret || ""))
    .update(value)
    .digest("base64url");
}

function safeRedirect(value) {
  const next = String(value || "/");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("://")) {
    return "/";
  }
  return next;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cookieAttributes(request, maxAgeSeconds = SESSION_DURATION_SECONDS) {
  const secure =
    request.secure ||
    String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
  return [
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function createSessionCookie(settings, request) {
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  const payload = `${settings.Auth.Username}:${expiresAt}`;
  const encoded = base64Url(payload);
  return `${COOKIE_NAME}=${encodeURIComponent(`${encoded}.${sign(encoded, settings.Auth.PasswordHash)}`)}; ${cookieAttributes(request)}`;
}

function clearSessionCookie(request) {
  return `${COOKIE_NAME}=; ${cookieAttributes(request, 0)}`;
}

function hasValidSessionCookie(request, settings) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return false;
  const expected = sign(encoded, settings.Auth.PasswordHash);
  if (!safeEqual(signature, expected)) return false;

  const [username, expiresAt] = fromBase64Url(encoded).split(":");
  return (
    safeEqual(username, settings.Auth.Username) &&
    Number(expiresAt) > Date.now()
  );
}

function acceptsHtml(request) {
  return String(request.headers.accept || "").includes("text/html");
}

function requestKey(request) {
  return request.ip || request.socket?.remoteAddress || "unknown";
}

function loginPage({ next = "/", error = "" } = {}) {
  const safeNext = safeRedirect(next);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scrubarr sign in</title>
    <style>
      :root {
        color-scheme: dark;
        --accent: #facc15;
        --canvas: #111318;
        --panel: #1f232b;
        --line: #333845;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #252a33, var(--canvas));
        color: #f5f5f5;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(92vw, 28rem);
        border: 1px solid var(--line);
        border-radius: 1.25rem;
        background: rgba(31, 35, 43, 0.96);
        padding: 2rem;
        box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.35);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 0.9rem;
      }
      .sponge {
        font-size: 0;
        line-height: 1;
        filter: drop-shadow(0 2px 0 #000);
      }
      .sponge::before {
        content: "\\1F9FD";
        font-size: 3rem;
      }
      h1 {
        margin: 0;
        font-size: 2.4rem;
        line-height: 1;
        text-shadow: 2px 2px 0 #000;
      }
      .subtitle {
        margin: 0.45rem 0 1.5rem;
        color: #d4d4d4;
      }
      label {
        display: block;
        margin-top: 1rem;
        font-size: 0.9rem;
        color: #d4d4d4;
      }
      input {
        box-sizing: border-box;
        width: 100%;
        margin-top: 0.4rem;
        border: 1px solid var(--line);
        border-radius: 0.75rem;
        background: #111318;
        color: white;
        padding: 0.85rem 0.95rem;
        font: inherit;
        outline: none;
      }
      input:focus {
        border-color: var(--accent);
      }
      button {
        width: 100%;
        margin-top: 1.4rem;
        border: 0;
        border-radius: 0.75rem;
        background: var(--accent);
        color: #111318;
        padding: 0.9rem 1rem;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .error {
        margin-top: 1rem;
        border: 1px solid rgba(248, 113, 113, 0.65);
        border-radius: 0.75rem;
        background: rgba(127, 29, 29, 0.35);
        color: #fecaca;
        padding: 0.75rem;
        font-size: 0.9rem;
      }
      .note {
        margin-top: 1.25rem;
        color: #a3a3a3;
        font-size: 0.82rem;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">
        <div class="sponge" aria-hidden="true">🧽</div>
        <div>
          <h1>Scrubarr</h1>
          <p class="subtitle">Scrub Your Media Libraries Clean</p>
        </div>
      </div>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <form method="post" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
        <label>
          Username
          <input name="username" autocomplete="username" required autofocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p class="note">
        Built-in authentication is a simple local guard. Keep Scrubarr behind your reverse proxy,
        MFA, VPN, or another trusted external access layer for internet-facing use.
      </p>
    </main>
  </body>
</html>`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export class AuthAttemptTracker {
  constructor({
    maxFailedAttempts = DEFAULT_MAX_FAILED_ATTEMPTS,
    lockoutMilliseconds = DEFAULT_LOCKOUT_MILLISECONDS,
    now = () => Date.now(),
  } = {}) {
    this.maxFailedAttempts = maxFailedAttempts;
    this.lockoutMilliseconds = lockoutMilliseconds;
    this.now = now;
    this.attempts = new Map();
  }

  status(key) {
    const current = this.attempts.get(key);
    if (!current) {
      return { limited: false, failures: 0, retryAfterSeconds: 0 };
    }

    if (current.lockedUntil && current.lockedUntil > this.now()) {
      return {
        limited: true,
        failures: current.failures,
        retryAfterSeconds: Math.ceil((current.lockedUntil - this.now()) / 1000),
      };
    }

    if (current.lockedUntil && current.lockedUntil <= this.now()) {
      this.attempts.delete(key);
      return { limited: false, failures: 0, retryAfterSeconds: 0 };
    }

    return {
      limited: false,
      failures: current.failures,
      retryAfterSeconds: 0,
    };
  }

  recordFailure(key) {
    const current = this.attempts.get(key) || { failures: 0, lockedUntil: 0 };
    const failures = current.failures + 1;
    const lockedUntil = failures >= this.maxFailedAttempts
      ? this.now() + this.lockoutMilliseconds
      : 0;
    const next = { failures, lockedUntil };
    this.attempts.set(key, next);
    return {
      limited: Boolean(lockedUntil),
      failures,
      retryAfterSeconds: lockedUntil
        ? Math.ceil((lockedUntil - this.now()) / 1000)
        : 0,
    };
  }

  recordSuccess(key) {
    this.attempts.delete(key);
  }
}

function credentialsMatch(credentials, settings) {
  const usernameMatches =
    credentials?.username && safeEqual(credentials.username, settings.Auth.Username);
  const passwordMatches = verifyPassword(
    credentials?.password || "",
    settings.Auth.PasswordHash,
  );
  return Boolean(usernameMatches && passwordMatches);
}

function throttledLoginResponse(response, request, retryAfterSeconds) {
  response.set("Retry-After", String(Math.max(retryAfterSeconds, 1)));
  if (request.path.startsWith("/api/") || !acceptsHtml(request)) {
    response.status(429).json({
      error: "too_many_login_attempts",
      message: "Too many failed sign-in attempts. Try again shortly.",
    });
    return;
  }
  response
    .status(429)
    .type("html")
    .send(loginPage({
      next: request.body?.next || request.originalUrl,
      error: "Too many failed sign-in attempts. Try again shortly.",
    }));
}

export function createBasicAuthMiddleware({
  settingsStore,
  defaults,
  appLog,
  attemptTracker = new AuthAttemptTracker(),
}) {
  return async function basicAuth(request, response, next) {
    if (request.path === "/api/health" || request.path === "/api/health/") {
      next();
      return;
    }

    try {
      const settings = mergeSettings(defaults, await settingsStore.read());
      if (!settings.Auth?.Enabled) {
        next();
        return;
      }

      if (request.path === "/login" && request.method === "GET") {
        response.type("html").send(loginPage({ next: request.query.next }));
        return;
      }

      if (request.path === "/login" && request.method === "POST") {
        const key = requestKey(request);
        const throttle = attemptTracker.status(key);
        if (throttle.limited) {
          await appLog.warn("Basic auth login throttled", {
            path: request.originalUrl,
            retryAfterSeconds: throttle.retryAfterSeconds,
          });
          throttledLoginResponse(response, request, throttle.retryAfterSeconds);
          return;
        }

        const credentials = {
          username: request.body?.username || "",
          password: request.body?.password || "",
        };
        if (credentialsMatch(credentials, settings)) {
          attemptTracker.recordSuccess(key);
          response.set("Set-Cookie", createSessionCookie(settings, request));
          response.redirect(303, safeRedirect(request.body?.next));
          return;
        }

        const attempt = attemptTracker.recordFailure(key);
        await appLog.warn("Basic auth login failed", {
          path: request.originalUrl,
          failedAttempts: attempt.failures,
          locked: attempt.limited,
          retryAfterSeconds: attempt.retryAfterSeconds,
        });
        if (attempt.limited) {
          response.set("Retry-After", String(Math.max(attempt.retryAfterSeconds, 1)));
        }
        response
          .status(attempt.limited ? 429 : 401)
          .type("html")
          .send(loginPage({
            next: request.body?.next,
            error: attempt.limited
              ? "Too many failed sign-in attempts. Try again shortly."
              : "Username or password incorrect.",
          }));
        return;
      }

      if (request.path === "/logout") {
        response.set("Set-Cookie", clearSessionCookie(request));
        response.redirect(303, "/login");
        return;
      }

      const credentials = parseBasicAuth(request.headers.authorization);
      const key = requestKey(request);
      const hasCredentials = Boolean(credentials);
      if (hasCredentials) {
        const throttle = attemptTracker.status(key);
        if (throttle.limited) {
          await appLog.warn("Basic auth request throttled", {
            method: request.method,
            path: request.originalUrl,
            retryAfterSeconds: throttle.retryAfterSeconds,
          });
          throttledLoginResponse(response, request, throttle.retryAfterSeconds);
          return;
        }
      }

      if (credentialsMatch(credentials, settings) || hasValidSessionCookie(request, settings)) {
        if (hasCredentials) attemptTracker.recordSuccess(key);
        next();
        return;
      }

      const attempt = hasCredentials ? attemptTracker.recordFailure(key) : null;
      await appLog.warn("Basic auth rejected request", {
        method: request.method,
        path: request.originalUrl,
        failedAttempts: attempt?.failures || 0,
        locked: attempt?.limited === true,
        retryAfterSeconds: attempt?.retryAfterSeconds || 0,
      });
      if (request.path.startsWith("/api/") || !acceptsHtml(request)) {
        response.status(401).json({
          error: "authentication_required",
          message: "Please sign in to Scrubarr.",
        });
        return;
      }
      response
        .status(200)
        .type("html")
        .send(loginPage({ next: request.originalUrl }));
    } catch (error) {
      next(error);
    }
  };
}
