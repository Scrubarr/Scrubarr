import assert from "node:assert/strict";
import test from "node:test";
import {
  deletionDeferralNeedsAttention,
  deletionDeferralRemovesPending,
} from "../src/services/deletion-deferrals.js";

test("only deterministic cleanup-rule failures remove a due item from pending", () => {
  for (const SkipCode of [
    "in-progress",
    "excluded",
    "age-rule-not-met",
    "watched-rule-not-met",
    "unwatched-rule-not-met",
    "too-new",
    "year-before-filter",
    "year-after-filter",
    "genre-not-included",
    "genre-excluded",
  ]) {
    assert.equal(deletionDeferralRemovesPending({ SkipCode }), true, SkipCode);
  }

  for (const SkipCode of [
    "media-in-use",
    "already-pending",
    "watch-history-unknown",
    "missing-arr-date",
    "revalidation-unavailable",
    "media-server-item-not-found",
    "media-server-item-changed",
    "arr-identity-changed",
    "revalidation-required",
    "unknown-reason",
  ]) {
    assert.equal(deletionDeferralRemovesPending({ SkipCode }), false, SkipCode);
  }
});

test("uncertain and integrity-related outcomes require attention", () => {
  assert.equal(deletionDeferralNeedsAttention({ SkipCode: "media-in-use" }), false);
  assert.equal(deletionDeferralNeedsAttention({ SkipCode: "age-rule-not-met" }), false);
  assert.equal(deletionDeferralNeedsAttention({ SkipCode: "already-pending" }), true);
  assert.equal(deletionDeferralNeedsAttention({ SkipCode: "revalidation-unavailable" }), true);
  assert.equal(deletionDeferralNeedsAttention({ SkipCode: "unknown-reason" }), true);
});
