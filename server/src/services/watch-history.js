export function normalizeWatchHistory(userData) {
  const data = userData && typeof userData === "object" && !Array.isArray(userData)
    ? userData
    : {};
  const playCount = Number.isSafeInteger(data.PlayCount) && data.PlayCount >= 0
    ? data.PlayCount
    : null;
  const played = data.Played === true;
  const playedFlagValid = data.Played === undefined || typeof data.Played === "boolean";
  const hasDate = data.LastPlayedDate !== undefined && data.LastPlayedDate !== null;
  const date = hasDate && typeof data.LastPlayedDate === "string"
    ? new Date(data.LastPlayedDate)
    : null;
  const dateValid = date && !Number.isNaN(date.getTime()) && date.getUTCFullYear() > 1;
  const lastPlayedDate = dateValid ? date.toISOString() : null;
  const hasPlayback = played || playCount > 0 || lastPlayedDate !== null;

  // Missing history is not evidence that a title has never been watched.
  const known = playCount !== null && playedFlagValid &&
    (!hasDate || Boolean(dateValid)) && (!hasPlayback || lastPlayedDate !== null);
  return { known, playCount, played, lastPlayedDate, hasPlayback };
}
