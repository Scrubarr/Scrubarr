import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPath,
  isFilesystemRoot,
  isInsideClassifiedRoot,
  mediaRootOf,
  parentPathCandidates,
  runtimeSupportsPathKind,
} from "../src/services/path-classifier.js";

test("classifies Windows drive, UNC, and Linux absolute paths", () => {
  const windows = classifyPath("C:\\Media\\Movies\\Film.mkv");
  const unc = classifyPath("\\\\server\\share\\Series\\Show");
  const linux = classifyPath("/mnt/media/movies/film.mkv");

  assert.equal(windows.ok, true);
  assert.equal(windows.kind, "win32");
  assert.equal(windows.normalized, "C:\\Media\\Movies\\Film.mkv");
  assert.equal(unc.ok, true);
  assert.equal(unc.kind, "win32");
  assert.equal(unc.normalized, "\\\\server\\share\\Series\\Show");
  assert.equal(linux.ok, true);
  assert.equal(linux.kind, "posix");
  assert.equal(linux.normalized, "/mnt/media/movies/film.mkv");
});

test("rejects blank and relative paths", () => {
  assert.equal(classifyPath("").message, "Path is blank.");
  assert.equal(classifyPath("relative/path").message, "Path must be absolute.");
});

test("reports media roots consistently across path styles", () => {
  assert.deepEqual(mediaRootOf("D:\\Media\\Movie.mkv"), {
    value: "D:",
    type: "windows",
    kind: "win32",
  });
  assert.deepEqual(mediaRootOf("\\\\server\\share\\Movie.mkv"), {
    value: "\\\\server\\share",
    type: "windows",
    kind: "win32",
  });
  assert.deepEqual(mediaRootOf("/srv/media/movie.mkv"), {
    value: "/srv",
    type: "posix",
    kind: "posix",
  });
});

test("builds parent candidates with the classified path API", () => {
  assert.deepEqual(
    parentPathCandidates("/mnt/media/movies/film.mkv", 3),
    ["/mnt/media/movies/film.mkv", "/mnt/media/movies", "/mnt/media", "/mnt"],
  );
  assert.deepEqual(
    parentPathCandidates("C:\\Media\\Movies\\Film.mkv", 3),
    [
      "C:\\Media\\Movies\\Film.mkv",
      "C:\\Media\\Movies",
      "C:\\Media",
      "C:\\",
    ],
  );
});

test("shared inside-root checks support Linux and Windows path families", () => {
  assert.equal(
    isInsideClassifiedRoot(
      classifyPath("/mnt/media/movies/film.mkv"),
      classifyPath("/mnt/media"),
    ),
    true,
  );
  assert.equal(
    isInsideClassifiedRoot(
      classifyPath("C:\\Media\\Movies\\Film.mkv"),
      classifyPath("C:\\Media"),
    ),
    true,
  );
  assert.equal(
    isInsideClassifiedRoot(
      classifyPath("C:\\Other\\Film.mkv"),
      classifyPath("C:\\Media"),
    ),
    false,
  );
});

test("runtime support and filesystem root checks remain explicit", () => {
  assert.equal(runtimeSupportsPathKind("win32", "win32"), true);
  assert.equal(runtimeSupportsPathKind("win32", "linux"), false);
  assert.equal(runtimeSupportsPathKind("posix", "linux"), true);
  assert.equal(runtimeSupportsPathKind("posix", "win32"), false);
  assert.equal(isFilesystemRoot(classifyPath("C:\\")), true);
  assert.equal(isFilesystemRoot(classifyPath("/")), true);
  assert.equal(isFilesystemRoot(classifyPath("/mnt")), false);
});
