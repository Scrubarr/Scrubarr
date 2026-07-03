function asList(value) {
  return Array.isArray(value) ? value : [];
}

function keyFor(value) {
  return `${value.Type || "Item"}|${value.ItemId}`;
}

function validIsoDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function applyInProgressTracking({ items, records, now = new Date() }) {
  const nowIso = now.toISOString();
  const existing = new Map(
    asList(records)
      .filter((record) => record?.ItemId && record?.Type)
      .map((record) => [keyFor(record), record]),
  );
  const tracked = new Map();

  const nextItems = asList(items).map((item) => {
    if (!item.InProgress || !item.ItemId) return item;

    const key = keyFor(item);
    const firstSeenDate = validIsoDate(existing.get(key)?.FirstSeenDate) || nowIso;
    const record = {
      ItemId: String(item.ItemId),
      Type: item.Type,
      Title: item.Title || "Untitled",
      FirstSeenDate: firstSeenDate,
      LastSeenDate: nowIso,
    };
    tracked.set(key, record);
    return {
      ...item,
      InProgressSince: firstSeenDate,
    };
  });

  return {
    items: nextItems,
    records: [...tracked.values()].sort((left, right) =>
      `${left.Type}|${left.Title}`.localeCompare(
        `${right.Type}|${right.Title}`,
        undefined,
        { sensitivity: "base" },
      ),
    ),
  };
}
