function hasValue(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

export function hasDeletionMarker(item) {
  if (!item) return false;
  return hasValue(item.Deleted) || hasValue(item.DeletedDate);
}

export function isActivePendingItem(item) {
  return Boolean(item) && !hasDeletionMarker(item);
}

export function activePendingItems(pending) {
  return (Array.isArray(pending) ? pending : []).filter(isActivePendingItem);
}
