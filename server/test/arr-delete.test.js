import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteMovieViaRadarr,
  deleteSeriesViaSonarr,
} from "../src/services/arr-delete.js";

test("Radarr deletion requests file deletion and import exclusion", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: new URL(String(url)), method: options.method, headers: options.headers });
    return new Response(null, { status: 204 });
  };

  try {
    await deleteMovieViaRadarr(
      { Arrs: { Radarr: { Enabled: true, Url: "http://radarr.local", ApiKey: "radarr-key" } } },
      { ArrId: 123 },
    );

    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].url.pathname, "/api/v3/movie/123");
    assert.equal(calls[0].url.searchParams.get("deleteFiles"), "true");
    assert.equal(calls[0].url.searchParams.get("addImportExclusion"), "true");
    assert.equal(calls[0].headers["X-Api-Key"], "radarr-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Sonarr deletion requests file deletion and import-list exclusion", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: new URL(String(url)), method: options.method, headers: options.headers });
    return new Response(null, { status: 204 });
  };

  try {
    await deleteSeriesViaSonarr(
      { Arrs: { Sonarr: { Enabled: true, Url: "http://sonarr.local", ApiKey: "sonarr-key" } } },
      { ArrId: 456 },
    );

    assert.equal(calls[0].method, "DELETE");
    assert.equal(calls[0].url.pathname, "/api/v3/series/456");
    assert.equal(calls[0].url.searchParams.get("deleteFiles"), "true");
    assert.equal(calls[0].url.searchParams.get("addImportListExclusion"), "true");
    assert.equal(calls[0].headers["X-Api-Key"], "sonarr-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
