import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWatchHistory } from "../src/services/watch-history.js";

test("explicit zero playback with no date is known never-watched history", () => {
  assert.deepEqual(normalizeWatchHistory({ Played: false, PlayCount: 0 }), {
    known: true, played: false, playCount: 0, lastPlayedDate: null, hasPlayback: false,
  });
});

test("played flags and playback dates remain evidence even with a zero count", () => {
  for (const Played of [true, false, undefined]) {
    const history = normalizeWatchHistory({
      Played, PlayCount: 0, LastPlayedDate: "2026-10-01T13:00:00+13:00",
    });
    assert.equal(history.known, true);
    assert.equal(history.hasPlayback, true);
    assert.equal(history.lastPlayedDate, "2026-10-01T00:00:00.000Z");
  }
});

test("incomplete or malformed history cannot be treated as never watched", () => {
  for (const data of [
    null, undefined, [], {}, { Played: false }, { PlayCount: null },
    { PlayCount: "0" }, { PlayCount: -1 }, { PlayCount: NaN },
    { PlayCount: 0.5 }, { PlayCount: Infinity }, { PlayCount: 0, Played: "false" },
    { PlayCount: 0, LastPlayedDate: "invalid" }, { PlayCount: 0, LastPlayedDate: "" },
    { PlayCount: 0, LastPlayedDate: "0001-01-01T00:00:00Z" },
    { PlayCount: 1 }, { PlayCount: 0, Played: true },
    { Played: true, LastPlayedDate: "2026-10-01T00:00:00Z" },
  ]) {
    assert.equal(normalizeWatchHistory(data).known, false, JSON.stringify(data));
  }
});

test("positive play counts do not require the completed-playback flag", () => {
  const history = normalizeWatchHistory({
    Played: false, PlayCount: 2, LastPlayedDate: "2025-01-01T00:00:00Z",
  });
  assert.equal(history.known, true);
  assert.equal(history.hasPlayback, true);
});
