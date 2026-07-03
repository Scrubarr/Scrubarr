import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore, JsonStoreError } from "../src/storage/json-store.js";

test("returns a cloned default when the file does not exist", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-store-"));
  const defaultValue = [];
  const store = new JsonStore(path.join(directory, "missing.json"), defaultValue);

  const result = await store.read();
  result.push("changed");

  assert.deepEqual(defaultValue, []);
});

test("writes and reads JSON atomically", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-store-"));
  const file = path.join(directory, "items.json");
  const store = new JsonStore(file, []);
  const items = [{ ItemId: "123", Title: "Example" }];

  await store.write(items);

  assert.deepEqual(await store.read(), items);
  assert.equal((await fs.readFile(file, "utf8")).endsWith("\n"), true);
});

test("accepts legacy UTF-8 BOM files without rewriting them", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-store-"));
  const file = path.join(directory, "items.json");
  await fs.writeFile(file, `\ufeff${JSON.stringify([{ ItemId: "123" }])}`, "utf8");

  const store = new JsonStore(file, []);

  assert.deepEqual(await store.read(), [{ ItemId: "123" }]);
});

test("reports malformed JSON instead of replacing it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-store-"));
  const file = path.join(directory, "items.json");
  await fs.writeFile(file, "{broken", "utf8");

  const store = new JsonStore(file, []);

  await assert.rejects(store.read(), JsonStoreError);
  assert.equal(await fs.readFile(file, "utf8"), "{broken");
});

