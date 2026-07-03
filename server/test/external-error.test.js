import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalServiceError,
  externalServiceFailure,
  fetchExternal,
} from "../src/services/external-error.js";

test("fetchExternal includes service, operation, and status in safe HTTP failures", async () => {
  await assert.rejects(
    fetchExternal({
      service: "Emby",
      operation: "load libraries",
      url: "http://emby.example.local/System/Info",
      fetchImpl: async () =>
        new Response("", { status: 401, statusText: "Unauthorized" }),
    }),
    (error) => {
      assert.equal(error instanceof ExternalServiceError, true);
      assert.equal(error.service, "Emby");
      assert.equal(error.operation, "load libraries");
      assert.equal(error.status, 401);
      assert.equal(
        error.message,
        "Emby load libraries failed: HTTP 401 authentication failed; check the API key, token, or permissions",
      );
      return true;
    },
  );
});

test("fetchExternal gives safe common HTTP failure hints", async () => {
  await assert.rejects(
    fetchExternal({
      service: "Radarr",
      operation: "delete media",
      url: "http://radarr.example.local/api/v3/movie/1",
      fetchImpl: async () =>
        new Response("", { status: 404, statusText: "Movie abcdefghijklmnopqrstuvwxyz123456 not found" }),
    }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(
        error.message,
        "Radarr delete media failed: HTTP 404 not found; the item or endpoint may no longer exist",
      );
      assert.equal(error.message.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
      return true;
    },
  );

  await assert.rejects(
    fetchExternal({
      service: "Sonarr",
      operation: "load disk space",
      url: "http://sonarr.example.local/api/v3/diskspace",
      fetchImpl: async () =>
        new Response("", { status: 503, statusText: "Service Unavailable" }),
    }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(
        error.message,
        "Sonarr load disk space failed: HTTP 503 service is unavailable or returned a server error",
      );
      return true;
    },
  );
});

test("fetchExternal redacts token-shaped values from network failures", async () => {
  await assert.rejects(
    fetchExternal({
      service: "Telegram",
      operation: "send message",
      url: "https://api.telegram.org/bot123456:secret-token/sendMessage",
      fetchImpl: async () => {
        throw new Error(
          "request to https://api.telegram.org/bot123456:secret-token/sendMessage failed with abcdefghijklmnopqrstuvwxyz123456",
        );
      },
    }),
    (error) => {
      assert.equal(error instanceof ExternalServiceError, true);
      assert.match(error.message, /Telegram send message failed/);
      assert.match(error.message, /bot\[redacted\]/);
      assert.match(error.message, /\[redacted\]/);
      assert.equal(error.message.includes("secret-token"), false);
      assert.equal(error.message.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
      return true;
    },
  );
});

test("externalServiceFailure creates consistent service error messages", () => {
  const error = externalServiceFailure({
    service: "Radarr",
    operation: "delete media",
    detail: "blocked by remote server",
  });

  assert.equal(error instanceof ExternalServiceError, true);
  assert.equal(error.message, "Radarr delete media failed: blocked by remote server");
});
