import { isSameExclusion, normalizeExclusion } from "./exclusions.js";
import { previewScan } from "./scan-engine.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

export function formatDateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value,
    ]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function createPendingRecords(candidates, markedDate) {
  return candidates.map((candidate) => ({
    Title: candidate.Title,
    Type: candidate.Type,
    ...(candidate.Year ? { Year: candidate.Year } : {}),
    Path: candidate.Path || null,
    ItemId: String(candidate.ItemId),
    Arr: candidate.Arr || null,
    ArrId: Number.isInteger(candidate.ArrId) ? candidate.ArrId : null,
    HasPrimaryImage: Boolean(candidate.HasPrimaryImage),
    Genres: Array.isArray(candidate.Genres) ? candidate.Genres : [],
    Reason: candidate.Reason || null,
    QualificationReasons: Array.isArray(candidate.QualificationReasons)
      ? candidate.QualificationReasons
          .map((reason) => String(reason || "").trim())
          .filter(Boolean)
      : [],
    DateSource: candidate.DateSource || null,
    QualifyingDate: candidate.QualifyingDate || null,
    SeriesInactiveDays: Number.isInteger(candidate.SeriesInactiveDays)
      ? candidate.SeriesInactiveDays
      : null,
    MarkedDate: markedDate,
    Notified: [],
    Deleted: null,
  }));
}

export function evaluateQueueCommit({
  selectedItemIds,
  items,
  settings,
  exclusions,
  pending,
  now,
  timezone,
}) {
  const requestedIds = new Set(selectedItemIds.map(String));
  const selectedItems = items.filter((item) =>
    requestedIds.has(String(item.ItemId)),
  );
  const preview = previewScan({
    items: selectedItems,
    settings,
    exclusions: asList(exclusions),
    pending: asList(pending),
    now,
  });
  const records = createPendingRecords(
    preview.candidates,
    formatDateInTimezone(now, timezone),
  );
  const addedIds = new Set(records.map((record) => String(record.ItemId)));

  return {
    records,
    skippedItemIds: [...requestedIds].filter((id) => !addedIds.has(id)),
    summary: preview.summary,
  };
}

export function removePendingItem(pending, itemId) {
  const current = asList(pending);
  const removed = current.find((item) => String(item.ItemId) === String(itemId));
  if (!removed) return { removed: null, remaining: current };
  return {
    removed,
    remaining: current.filter(
      (item) => String(item.ItemId) !== String(itemId),
    ),
  };
}

export function exclusionFromPending(item) {
  return normalizeExclusion({
    ItemId: item.ItemId,
    Title: item.Title,
    Type: item.Type,
    Year: item.Year,
    Arr: item.Arr,
    ArrId: item.ArrId,
    Path: item.Path,
    HasPrimaryImage: item.HasPrimaryImage,
    Reason: item.Reason,
    QualificationReasons: Array.isArray(item.QualificationReasons)
      ? item.QualificationReasons
      : [],
    DateSource: item.DateSource,
    QualifyingDate: item.QualifyingDate,
    SeriesInactiveDays: item.SeriesInactiveDays,
  });
}

export function appendExclusion(exclusions, exclusion) {
  const current = asList(exclusions);
  return current.some((item) => isSameExclusion(item, exclusion))
    ? current
    : [...current, exclusion];
}
