import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthAttemptTracker,
  hashPassword,
  verifyPassword,
} from "../src/services/auth.js";

test("password hashes verify without storing the original password", () => {
  const hash = hashPassword("correct horse battery staple");

  assert.equal(hash.includes("correct horse"), false);
  assert.equal(verifyPassword("correct horse battery staple", hash), true);
  assert.equal(verifyPassword("wrong password", hash), false);
});

test("auth attempt tracker locks after repeated failures and resets after success", () => {
  let now = 1_000;
  const tracker = new AuthAttemptTracker({
    maxFailedAttempts: 2,
    lockoutMilliseconds: 5_000,
    now: () => now,
  });

  assert.deepEqual(tracker.status("client"), {
    limited: false,
    failures: 0,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(tracker.recordFailure("client"), {
    limited: false,
    failures: 1,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(tracker.recordFailure("client"), {
    limited: true,
    failures: 2,
    retryAfterSeconds: 5,
  });
  assert.equal(tracker.status("client").limited, true);

  now += 5_001;
  assert.deepEqual(tracker.status("client"), {
    limited: false,
    failures: 0,
    retryAfterSeconds: 0,
  });

  tracker.recordFailure("client");
  tracker.recordSuccess("client");
  assert.equal(tracker.status("client").failures, 0);
});
