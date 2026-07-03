import assert from "node:assert/strict";
import test from "node:test";
import {
  isPendingMutationBusy,
  PendingMutationCoordinator,
} from "../src/services/pending-mutation-coordinator.js";

test("pending mutation coordinator rejects overlapping operations", async () => {
  const coordinator = new PendingMutationCoordinator();
  let releaseFirstOperation;

  const firstOperation = coordinator.run(
    "first-operation",
    () =>
      new Promise((resolve) => {
        releaseFirstOperation = resolve;
      }),
  );

  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.status().operation, "first-operation");

  await assert.rejects(
    coordinator.run("second-operation", async () => "should not run"),
    (error) => {
      assert.equal(isPendingMutationBusy(error), true);
      assert.equal(error.code, "pending_queue_busy");
      assert.equal(error.operation, "second-operation");
      assert.equal(error.activeOperation, "first-operation");
      return true;
    },
  );

  releaseFirstOperation("complete");
  assert.equal(await firstOperation, "complete");
  assert.equal(coordinator.isBusy(), false);
});

test("pending mutation coordinator releases lock after failure", async () => {
  const coordinator = new PendingMutationCoordinator();

  await assert.rejects(
    coordinator.run("failing-operation", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  assert.equal(coordinator.isBusy(), false);
  assert.equal(await coordinator.run("next-operation", async () => "ok"), "ok");
});
