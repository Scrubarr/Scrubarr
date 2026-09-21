import assert from "node:assert/strict";
import test from "node:test";
import { ScanCoordinator } from "../src/services/scan-coordinator.js";
import { ExternalServiceError } from "../src/services/external-error.js";
import { collectScanItems } from "../src/services/scan-sources.js";
import { createDefaultSettings } from "../src/config/settings.js";

test("only transient read failures before pending writes qualify for retry", async () => {
  const coordinator = new ScanCoordinator({});
  for (const [status, retryable] of [[null, true], [503, true], [429, true], [408, true], [401, false], [403, false], [404, false]]) {
    coordinator.buildPreview = async () => { throw new ExternalServiceError({ service: "Emby", status }); };
    await assert.rejects(coordinator.commitEligibleCandidates({ timezone: "UTC" }), (error) => {
      assert.equal(error.retryableBeforeCommit, retryable);
      return true;
    });
    assert.equal(coordinator.isBusy(), false);
  }
  coordinator.buildPreview = async () => { throw new Error("corrupt settings"); };
  await assert.rejects(coordinator.commitEligibleCandidates({ timezone: "UTC" }), (error) => error.retryableBeforeCommit === false);
});

test("an ambiguous pending write must not be replayed", async () => {
  const coordinator = new ScanCoordinator({ pendingStore: { write: async () => { throw new ExternalServiceError({ status: 503 }); } } });
  coordinator.buildPreview = async () => ({ pending: [], result: { candidates: [{ ItemId: "movie-1", Type: "Movie", Title: "Fixture" }] } });
  await assert.rejects(coordinator.commitEligibleCandidates({ timezone: "UTC" }), (error) => error.retryableBeforeCommit === false);
  assert.equal(coordinator.isBusy(), false);
});

test("a competing scan is retryable before starting a commit", async () => {
  const coordinator = new ScanCoordinator({});
  coordinator.previewRunning = true;
  await assert.rejects(coordinator.commitEligibleCandidates(), (error) => error.retryableBeforeCommit === true);
});

test("response body timeouts retain service context and can be retried before writes", async (t) => {
  const settings = createDefaultSettings({});
  settings.MediaServer.Provider = "emby";
  settings.Emby.ServerUrl = "http://fixture.invalid";
  settings.Emby.ApiKey = "test-key";
  settings.Emby.SearchLibraries = ["Movies"];
  settings.Emby.UserIds = ["fixture-user"];
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => { throw new DOMException("body timeout", "AbortError"); } }));
  const coordinator = new ScanCoordinator({});
  coordinator.buildPreview = () => collectScanItems(settings);
  await assert.rejects(coordinator.commitEligibleCandidates({ timezone: "UTC" }), (error) => {
    assert.equal(error.service, "Emby");
    assert.equal(error.retryableBeforeCommit, true);
    return true;
  });
});
