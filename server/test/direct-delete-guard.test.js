import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeDirectDeletionPath,
  validateDirectDeletionPath,
} from "../src/services/direct-delete-guard.js";

test("direct delete guard accepts Linux paths inside approved roots", () => {
  const result = validateDirectDeletionPath({
    targetPath: "/media/movies/Example Movie",
    allowedRoots: ["/media/movies"],
    platform: "linux",
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "/media/movies/Example Movie");
});

test("direct delete guard accepts Windows drive paths inside approved roots", () => {
  const result = validateDirectDeletionPath({
    targetPath: "D:\\Media\\Movies\\Example Movie",
    allowedRoots: ["d:\\media\\movies"],
    platform: "win32",
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "D:\\Media\\Movies\\Example Movie");
});

test("direct delete guard accepts UNC paths inside approved roots", () => {
  const result = validateDirectDeletionPath({
    targetPath: "\\\\server\\share\\Media\\Example Movie",
    allowedRoots: ["\\\\server\\share\\Media"],
    platform: "win32",
  });

  assert.equal(result.ok, true);
});

test("direct delete guard rejects broad, relative, and unapproved paths", () => {
  const cases = [
    { targetPath: "", allowedRoots: ["/media"], platform: "linux", message: /blank/ },
    { targetPath: "media/movie", allowedRoots: ["/media"], platform: "linux", message: /absolute/ },
    { targetPath: "/", allowedRoots: ["/media"], platform: "linux", message: /root/ },
    { targetPath: "C:\\", allowedRoots: ["C:\\Media"], platform: "win32", message: /root/ },
    {
      targetPath: "\\\\server\\share\\",
      allowedRoots: ["\\\\server\\share\\Media"],
      platform: "win32",
      message: /root/,
    },
    {
      targetPath: "/etc/passwd",
      allowedRoots: ["/media"],
      platform: "linux",
      message: /outside approved/,
    },
    {
      targetPath: "/media/movie",
      allowedRoots: [],
      platform: "linux",
      message: /No approved/,
    },
    {
      targetPath: "D:\\Media\\Movie",
      allowedRoots: ["D:\\Media"],
      platform: "linux",
      message: /not accessible/,
    },
  ];

  for (const testCase of cases) {
    const result = validateDirectDeletionPath(testCase);
    assert.equal(result.ok, false, testCase.targetPath);
    assert.match(result.message, testCase.message);
  }
});

test("direct delete guard verifies real paths before filesystem deletion", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scrubarr-delete-guard-"));
  const root = path.join(directory, "media");
  const target = path.join(root, "movie");

  try {
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "movie.mkv"), "media", "utf8");

    const result = await assertSafeDirectDeletionPath({
      targetPath: target,
      allowedRoots: [root],
      platform: process.platform,
    });

    assert.equal(result.path, await fs.realpath(target));
    assert.equal(result.root, await fs.realpath(root));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
