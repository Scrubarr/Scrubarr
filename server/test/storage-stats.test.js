import assert from "node:assert/strict";
import test from "node:test";
import { storageByMediaRoot } from "../src/services/storage-stats.js";

test("storage stats groups Windows and Linux media paths by classified roots", async () => {
  const stats = await storageByMediaRoot(
    [
      { Path: "B:\\Media\\Movies\\Movie One.mkv" },
      { Path: "B:\\Media\\Movies\\Movie Two.mkv" },
      { Path: "/srv/media/series/show/episode.mkv" },
    ],
    [
      {
        source: "Radarr",
        path: "B:\\",
        label: "B:\\",
        totalSpace: 1000,
        freeSpace: 250,
      },
      {
        source: "Sonarr",
        path: "/srv",
        label: "/srv",
        totalSpace: 2000,
        freeSpace: 1500,
      },
    ],
  );

  const byRoot = new Map(stats.map((item) => [item.root, item]));

  assert.equal(byRoot.get("B:").available, true);
  assert.equal(byRoot.get("B:").mediaCount, 2);
  assert.equal(byRoot.get("B:").usedBytes, 750);
  assert.equal(byRoot.get("/srv").available, true);
  assert.equal(byRoot.get("/srv").mediaCount, 1);
  assert.equal(byRoot.get("/srv").usedBytes, 500);
});

test("storage stats reports incompatible host path families as unavailable", async () => {
  const stats = await storageByMediaRoot([{ Path: "Z:\\Media\\Movie.mkv" }], []);
  const entry = stats[0];

  if (process.platform === "win32") {
    assert.equal(entry.root, "Z:");
    assert.equal(entry.available, false);
    assert.match(entry.message, /not accessible|not mounted/i);
  } else {
    assert.equal(entry.root, "Z:");
    assert.equal(entry.available, false);
    assert.match(entry.message, /not mounted/i);
  }
});
