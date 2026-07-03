function describeDays(days) {
  if (days === 0) return "disabled";
  if (days % 365 === 0) {
    const years = days / 365;
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function mediaAgePhrase(mode, settings) {
  if (mode === "watched") {
    return `media was last watched at least ${describeDays(settings.Mode.WatchedDays)} ago`;
  }
  if (mode === "unwatched") {
    return `media was not watched and added at least ${describeDays(settings.Mode.UnwatchedDays)} ago`;
  }
  return `media was last watched at least ${describeDays(settings.Mode.WatchedDays)} ago, or media was not watched and added at least ${describeDays(settings.Mode.UnwatchedDays)} ago`;
}

function cleanupFilterPhrases(filters = {}) {
  const phrases = [];
  const hasYearFrom = Number.isInteger(filters.YearFrom);
  const hasYearTo = Number.isInteger(filters.YearTo);
  if (hasYearFrom && hasYearTo) {
    phrases.push(`released between ${filters.YearFrom} and ${filters.YearTo}`);
  } else if (hasYearFrom) {
    phrases.push(`released in ${filters.YearFrom} or later`);
  } else if (hasYearTo) {
    phrases.push(`released in ${filters.YearTo} or earlier`);
  }

  if (filters.IncludeGenres?.length > 0) {
    phrases.push(`matching one of these genres: ${filters.IncludeGenres.join(", ")}`);
  }
  if (filters.ExcludeGenres?.length > 0) {
    phrases.push(`not in these skipped genres: ${filters.ExcludeGenres.join(", ")}`);
  }

  return phrases;
}

function filtersFor(type, settings) {
  const scoped = settings.CleanupFilters?.[type];
  if (scoped && typeof scoped === "object") {
    return scoped;
  }
  if (type === "Movies") {
    return settings.CleanupFilters || {};
  }
  return {
    YearFrom: settings.CleanupFilters?.YearFrom ?? null,
    YearTo: settings.CleanupFilters?.YearTo ?? null,
    IncludeGenres: [],
    ExcludeGenres: [],
  };
}

function seriesHandlingPhrase() {
  return "Whole-series cleanup: Scrubarr checks episode playback to decide whether a show has been watched, then manages a qualifying show as one pending item.";
}

export function cleanupRuleSummary(settings) {
  const minimumAge = settings.Mode.DaysOlderThan;
  const minimumAgeRule =
    minimumAge > 0
      ? `Extra safety gate: must be in Radarr/Sonarr for at least ${describeDays(minimumAge)}.`
      : null;
  const inProgressRule = settings.CleanupRules.ProtectInProgress
    ? `Continue Watching items are protected until they have been tracked there for ${describeDays(settings.Mode.UnwatchedDays)}.`
    : null;
  const movieFilters = cleanupFilterPhrases(filtersFor("Movies", settings));
  const seriesFilters = cleanupFilterPhrases(filtersFor("Series", settings));
  const movieMode = settings.Mode.MovieType || settings.Mode.Type;
  const seriesMode = settings.Mode.SeriesType || settings.Mode.Type;
  const movies = [
    `Eligible when ${mediaAgePhrase(movieMode, settings)}.`,
    minimumAgeRule,
    inProgressRule,
    ...movieFilters.map((phrase) => `Only consider movies ${phrase}.`),
  ].filter(Boolean);
  const series = [
    `Eligible when ${mediaAgePhrase(seriesMode, settings)}.`,
    seriesHandlingPhrase(),
    minimumAgeRule,
    inProgressRule,
    ...seriesFilters.map((phrase) => `Only consider series ${phrase}.`),
  ].filter(Boolean);
  const warnings = [];
  if (minimumAge > 0 && !settings.Arrs.Radarr.Enabled) {
    warnings.push(
      "Radarr is disabled, so movies without Radarr added dates will be skipped.",
    );
  }
  if (minimumAge > 0 && !settings.Arrs.Sonarr.Enabled) {
    warnings.push(
      "Sonarr is disabled, so series without Sonarr added dates will be skipped.",
    );
  }

  return { movies, series, warnings };
}
