import { isSameExclusion } from "./exclusions.js";
import { activePendingItems } from "./pending-state.js";

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysOld(date, now) {
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function fallbackAddedDate(item) {
  const choices = [
    ["arr", item.ArrDateAdded],
    ["emby-created", item.DateCreated],
    ["premiere", item.PremiereDate],
  ];
  for (const [source, value] of choices) {
    const date = parseDate(value);
    if (date) return { date, source };
  }
  return null;
}

function modeTypeForItem(item, settings) {
  if (item.Type === "Movie") return settings.Mode.MovieType || settings.Mode.Type;
  if (item.Type === "Series") return settings.Mode.SeriesType || settings.Mode.Type;
  return settings.Mode.Type;
}

function playbackForItem(item) {
  if (
    item.Type === "Series" &&
    item.EpisodeActivity
  ) {
    return {
      known: item.EpisodeActivity.WatchHistoryKnown !== false,
      playCount: Number(item.EpisodeActivity.PlayCount || 0),
      lastPlayedDate: item.EpisodeActivity.LastPlayedDate,
      dateSource: "emby-episode-last-played",
      reasonPrefix: "Latest episode watched",
    };
  }

  return {
    known: item.Type === "Series" ? false : item.WatchHistoryKnown !== false,
    playCount: Number(item.UserData?.PlayCount || 0),
    lastPlayedDate: item.UserData?.LastPlayedDate,
    dateSource: "emby-last-played",
    reasonPrefix: "Last played",
  };
}

function ageDecision(item, settings, now) {
  const modeType = modeTypeForItem(item, settings);
  const minimumAgeDays = settings.Mode.DaysOlderThan;
  let minimumAge = null;
  if (minimumAgeDays > 0) {
    const date = parseDate(item.ArrDateAdded);
    if (!date) {
      return { eligible: false, skip: "missing-arr-date" };
    }
    const age = daysOld(date, now);
    if (age < minimumAgeDays) {
      return { eligible: false, skip: "too-new" };
    }
    minimumAge = { age, days: minimumAgeDays };
  }

  const playback = playbackForItem(item);
  if (!playback.known) {
    return { eligible: false, skip: "watch-history-unknown" };
  }
  const lastPlayed = parseDate(playback.lastPlayedDate);
  const playCount = playback.playCount;
  const watchedOld =
    lastPlayed && daysOld(lastPlayed, now) >= settings.Mode.WatchedDays;
  const added = fallbackAddedDate(item);
  const unwatchedOld =
    playCount < 1 &&
    added &&
    daysOld(added.date, now) >= settings.Mode.UnwatchedDays;
  const minimumAgeReason = minimumAge
    ? `Arr added ${minimumAge.age} days ago (${minimumAge.days}+ day minimum)`
    : null;
  const qualificationReasons = (primaryReason) =>
    [primaryReason, minimumAgeReason].filter(Boolean);

  if (modeType === "watched") {
    if (!watchedOld) return { eligible: false, skip: "watched-rule-not-met" };
    const age = daysOld(lastPlayed, now);
    const reason =
      `${playback.reasonPrefix} ${age} days ago (${settings.Mode.WatchedDays}+ days)`;
    return {
      eligible: true,
      reason: qualificationReasons(reason).join("; "),
      qualificationReasons: qualificationReasons(reason),
      dateSource: playback.dateSource,
      qualifyingDate: lastPlayed.toISOString(),
    };
  }

  if (modeType === "unwatched") {
    if (!unwatchedOld) return { eligible: false, skip: "unwatched-rule-not-met" };
    const age = daysOld(added.date, now);
    const reason =
      `Unwatched and added ${age} days ago (${settings.Mode.UnwatchedDays}+ days)`;
    const seriesReason =
      item.Type === "Series" ? "No recorded episode playback" : null;
    return {
      eligible: true,
      reason: qualificationReasons(reason).join("; "),
      qualificationReasons: [reason, seriesReason, minimumAgeReason].filter(Boolean),
      dateSource: added.source,
      qualifyingDate: added.date.toISOString(),
    };
  }

  if (watchedOld) {
    const age = daysOld(lastPlayed, now);
    const reason =
      `${playback.reasonPrefix} ${age} days ago (${settings.Mode.WatchedDays}+ days)`;
    return {
      eligible: true,
      reason: qualificationReasons(reason).join("; "),
      qualificationReasons: qualificationReasons(reason),
      dateSource: playback.dateSource,
      qualifyingDate: lastPlayed.toISOString(),
    };
  }
  if (unwatchedOld) {
    const age = daysOld(added.date, now);
    const reason =
      `Unwatched and added ${age} days ago (${settings.Mode.UnwatchedDays}+ days)`;
    const seriesReason =
      item.Type === "Series" ? "No recorded episode playback" : null;
    return {
      eligible: true,
      reason: qualificationReasons(reason).join("; "),
      qualificationReasons: [reason, seriesReason, minimumAgeReason].filter(Boolean),
      dateSource: added.source,
      qualifyingDate: added.date.toISOString(),
    };
  }
  return { eligible: false, skip: "age-rule-not-met" };
}

function increment(counts, key) {
  counts[key] = (counts[key] || 0) + 1;
}

function normalizeTextList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : [];
}

function matchesCleanupFilters(item, filters = {}) {
  const year = Number(item.Year);
  const reasons = [];
  if (
    Number.isInteger(filters.YearFrom) &&
    (!Number.isInteger(year) || year < filters.YearFrom)
  ) {
    return { eligible: false, skip: "year-before-filter" };
  }
  if (
    Number.isInteger(filters.YearTo) &&
    (!Number.isInteger(year) || year > filters.YearTo)
  ) {
    return { eligible: false, skip: "year-after-filter" };
  }
  if (Number.isInteger(filters.YearFrom) && Number.isInteger(filters.YearTo)) {
    reasons.push(
      `Release year ${year} is between ${filters.YearFrom} and ${filters.YearTo}`,
    );
  } else if (Number.isInteger(filters.YearFrom)) {
    reasons.push(`Release year ${year} is ${filters.YearFrom} or newer`);
  } else if (Number.isInteger(filters.YearTo)) {
    reasons.push(`Release year ${year} is ${filters.YearTo} or older`);
  }

  const displayGenres = Array.isArray(item.Genres)
    ? item.Genres.map((genre) => String(genre || "").trim()).filter(Boolean)
    : [];
  const genres = displayGenres.map((genre) => genre.toLowerCase());
  const includeGenres = normalizeTextList(filters.IncludeGenres);
  const excludeGenres = normalizeTextList(filters.ExcludeGenres);
  if (
    includeGenres.length > 0 &&
    !includeGenres.some((genre) => genres.includes(genre))
  ) {
    return { eligible: false, skip: "genre-not-included" };
  }
  if (
    excludeGenres.length > 0 &&
    excludeGenres.some((genre) => genres.includes(genre))
  ) {
    return { eligible: false, skip: "genre-excluded" };
  }
  if (includeGenres.length > 0) {
    const matched = displayGenres
      .filter((genre) => includeGenres.includes(genre.toLowerCase()))
      .slice(0, 3);
    if (matched.length > 0) {
      reasons.push(
        `Matched include ${matched.length === 1 ? "genre" : "genres"}: ${matched.join(", ")}`,
      );
    }
  }

  return { eligible: true, reasons };
}

function filtersForItem(item, settings) {
  const key = item.Type === "Series" ? "Series" : "Movies";
  const scopedFilters = settings.CleanupFilters?.[key];
  if (scopedFilters && typeof scopedFilters === "object") return scopedFilters;
  if (item.Type !== "Series") return settings.CleanupFilters;

  return {
    YearFrom: settings.CleanupFilters?.YearFrom ?? null,
    YearTo: settings.CleanupFilters?.YearTo ?? null,
    IncludeGenres: [],
    ExcludeGenres: [],
  };
}

function inProgressIsProtected(item, settings, now) {
  if (!settings.CleanupRules.ProtectInProgress || !item.InProgress) return false;
  const firstSeen = parseDate(item.InProgressSince);
  if (!firstSeen) return true;
  return daysOld(firstSeen, now) < settings.Mode.UnwatchedDays;
}

function pendingCountsByType(activePending) {
  return {
    Movie: activePending.filter((item) => item.Type === "Movie").length,
    Series: activePending.filter((item) => item.Type === "Series").length,
  };
}

function candidateFromDecision(item, decision, now) {
  const seriesPlayback = item.Type === "Series"
    ? playbackForItem(item)
    : null;
  const seriesLastPlayed = parseDate(seriesPlayback?.lastPlayedDate);

  return {
    Title: item.Title,
    Type: item.Type,
    Year: item.Year || null,
    ItemId: item.ItemId,
    Path: item.ArrPath || item.Path || null,
    Arr: item.Arr || null,
    ArrId: item.ArrId || null,
    HasPrimaryImage: item.HasPrimaryImage,
    Genres: Array.isArray(item.Genres) ? item.Genres : [],
    Reason: decision.reason,
    QualificationReasons: [
      ...(Array.isArray(decision.qualificationReasons)
        ? decision.qualificationReasons
        : [decision.reason].filter(Boolean)),
      ...(Array.isArray(decision.filterReasons) ? decision.filterReasons : []),
    ],
    DateSource: decision.dateSource,
    QualifyingDate: decision.qualifyingDate,
    SeriesInactiveDays: item.Type === "Series" && seriesLastPlayed
      ? daysOld(seriesLastPlayed, now)
      : null,
  };
}

export function evaluateCleanupItem({
  item,
  settings,
  exclusions = [],
  activePending = [],
  pendingCounts = pendingCountsByType(activePending),
  selectedCounts = { Movie: 0, Series: 0 },
  now = new Date(),
} = {}) {
  const filterDecision = matchesCleanupFilters(item, filtersForItem(item, settings));
  if (!filterDecision.eligible) {
    return { eligible: false, skip: filterDecision.skip };
  }

  if (exclusions.some((excluded) => isSameExclusion(item, excluded))) {
    return { eligible: false, skip: "excluded" };
  }
  if (activePending.some((tracked) => isSameExclusion(item, tracked))) {
    return { eligible: false, skip: "already-pending" };
  }

  if (inProgressIsProtected(item, settings, now)) {
    return { eligible: false, skip: "in-progress" };
  }

  const decision = ageDecision(item, settings, now);
  if (!decision.eligible) {
    return { eligible: false, skip: decision.skip };
  }

  const limits = {
    Movie: settings.Limits.MaxMoviesMarked,
    Series: settings.Limits.MaxSeriesMarked,
  };
  if (pendingCounts[item.Type] + selectedCounts[item.Type] >= limits[item.Type]) {
    return { eligible: false, skip: `${item.Type.toLowerCase()}-limit` };
  }

  return {
    eligible: true,
    candidate: candidateFromDecision(
      item,
      {
        ...decision,
        filterReasons: filterDecision.reasons,
      },
      now,
    ),
    reason: decision.reason,
    dateSource: decision.dateSource,
    qualifyingDate: decision.qualifyingDate,
  };
}

export function previewScan({
  items,
  settings,
  exclusions = [],
  pending = [],
  now = new Date(),
  warnings = [],
}) {
  const activePending = activePendingItems(pending);
  const pendingCounts = pendingCountsByType(activePending);
  const selectedCounts = { Movie: 0, Series: 0 };
  const skipCounts = {};
  const candidates = [];

  for (const item of items) {
    const result = evaluateCleanupItem({
      item,
      settings,
      exclusions,
      activePending,
      pendingCounts,
      selectedCounts,
      now,
    });

    if (!result.eligible) {
      increment(skipCounts, result.skip);
      continue;
    }
    selectedCounts[item.Type] += 1;
    candidates.push(result.candidate);
  }

  return {
    generatedAt: now.toISOString(),
    readOnly: true,
    candidates,
    summary: {
      scanned: items.length,
      candidateMovies: selectedCounts.Movie,
      candidateSeries: selectedCounts.Series,
      existingPendingMovies: pendingCounts.Movie,
      existingPendingSeries: pendingCounts.Series,
      skipped: skipCounts,
    },
    warnings,
  };
}
