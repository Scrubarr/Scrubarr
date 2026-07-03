function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeExclusion(value) {
  const itemId = normalizeText(value?.ItemId);
  const title = normalizeText(value?.Title);
  const type = normalizeText(value?.Type);

  if (!itemId || !title || !["Movie", "Series"].includes(type)) {
    throw new Error("ItemId, Title, and a valid media Type are required");
  }

  const arr = ["Radarr", "Sonarr"].includes(value.Arr) ? value.Arr : null;
  const arrId = Number.isInteger(value.ArrId) ? value.ArrId : null;
  const year = Number.isInteger(value.Year) ? value.Year : null;
  const hasPrimaryImage =
    typeof value.HasPrimaryImage === "boolean" ? value.HasPrimaryImage : null;
  const path = normalizeText(value.Path) || null;
  const reason = normalizeText(value.Reason) || null;
  const dateSource = normalizeText(value.DateSource) || null;
  const qualifyingDate = normalizeText(value.QualifyingDate) || null;
  const seriesInactiveDays = Number.isInteger(value.SeriesInactiveDays)
    ? value.SeriesInactiveDays
    : null;

  return {
    Title: title,
    Type: type,
    ItemId: itemId,
    ...(year ? { Year: year } : {}),
    ...(path ? { Path: path } : {}),
    Arr: arr,
    ArrId: arrId,
    ...(hasPrimaryImage !== null ? { HasPrimaryImage: hasPrimaryImage } : {}),
    ...(reason ? { Reason: reason } : {}),
    ...(dateSource ? { DateSource: dateSource } : {}),
    ...(qualifyingDate ? { QualifyingDate: qualifyingDate } : {}),
    ...(seriesInactiveDays !== null ? { SeriesInactiveDays: seriesInactiveDays } : {}),
  };
}

export function isSameExclusion(left, right) {
  if (left.ItemId && right.ItemId && String(left.ItemId) === String(right.ItemId)) {
    return true;
  }
  if (
    left.Arr &&
    right.Arr &&
    left.ArrId &&
    right.ArrId &&
    left.Arr === right.Arr &&
    Number(left.ArrId) === Number(right.ArrId)
  ) {
    return true;
  }
  return (
    left.Type === right.Type &&
    normalizeText(left.Title).toLowerCase() ===
      normalizeText(right.Title).toLowerCase()
  );
}

export function markExcluded(items, exclusions) {
  return items.map((item) => {
    const exclusion = exclusions.find((candidate) =>
      isSameExclusion(item, candidate),
    );
    return {
      ...item,
      Excluded: Boolean(exclusion),
      ...(exclusion?.ItemId ? { ExclusionItemId: String(exclusion.ItemId) } : {}),
    };
  });
}
