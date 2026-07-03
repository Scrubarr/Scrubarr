import assert from "node:assert/strict";
import test from "node:test";
import {
  activePendingItems,
  hasDeletionMarker,
  isActivePendingItem,
} from "../src/services/pending-state.js";

test("pending state treats deleted dates as deletion markers", () => {
  assert.equal(hasDeletionMarker({ Deleted: true }), true);
  assert.equal(hasDeletionMarker({ Deleted: "2026-06-25" }), true);
  assert.equal(hasDeletionMarker({ DeletedDate: "2026-06-25" }), true);
  assert.equal(hasDeletionMarker({ Deleted: false }), false);
  assert.equal(hasDeletionMarker({ Deleted: null }), false);
  assert.equal(hasDeletionMarker({ Deleted: "" }), false);
});

test("pending state returns only active pending records", () => {
  const active = { ItemId: "active", Deleted: null };
  const deleted = { ItemId: "deleted", Deleted: "2026-06-25" };

  assert.equal(isActivePendingItem(active), true);
  assert.equal(isActivePendingItem(deleted), false);
  assert.deepEqual(activePendingItems([active, deleted]), [active]);
});
