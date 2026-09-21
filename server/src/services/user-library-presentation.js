function viewKey(view) {
  return String(
    view?.PresentationUniqueKey || view?.Guid || view?.ItemId || view?.Id || "",
  ).trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildLeavingSoonUserConfiguration({
  configuration,
  views,
  movieLibraryName,
  seriesLibraryName,
  primaryLibraryNames = [],
  keepTogether = true,
  includeInSecondarySections = false,
}) {
  const current = configuration && typeof configuration === "object"
    ? configuration
    : {};
  const availableViews = Array.isArray(views) ? views : [];
  const viewsByName = new Map(
    availableViews.map((view) => [String(view?.Name || "").trim().toLowerCase(), view]),
  );
  const movieKey = viewKey(
    viewsByName.get(String(movieLibraryName || "").trim().toLowerCase()),
  );
  const seriesKey = viewKey(
    viewsByName.get(String(seriesLibraryName || "").trim().toLowerCase()),
  );
  const managedKeys = [movieKey, seriesKey].filter(Boolean);

  if (managedKeys.length === 0) {
    return { changed: false, configuration: current, managedKeys: [] };
  }

  const next = structuredClone(current);
  const currentOrder = uniqueStrings(current.OrderedViews);
  let nextOrder = currentOrder;

  if (keepTogether) {
    const fallbackOrder = uniqueStrings(availableViews.map(viewKey));
    const baseOrder = currentOrder.length > 0 ? currentOrder : fallbackOrder;
    const managed = new Set(managedKeys);
    const withoutManaged = baseOrder.filter((key) => !managed.has(key));
    const preferredKeys = primaryLibraryNames
      .map((name) => viewKey(
        viewsByName.get(String(name || "").trim().toLowerCase()),
      ))
      .filter(Boolean);
    const preferredPositions = preferredKeys
      .map((key) => withoutManaged.indexOf(key))
      .filter((index) => index >= 0);
    const originalPositions = managedKeys
      .map((key) => baseOrder.indexOf(key))
      .filter((index) => index >= 0);
    const insertionIndex = preferredPositions.length > 0
      ? Math.max(...preferredPositions) + 1
      : Math.min(...originalPositions, withoutManaged.length);
    nextOrder = [
      ...withoutManaged.slice(0, insertionIndex),
      ...managedKeys,
      ...withoutManaged.slice(insertionIndex),
    ];
    next.OrderedViews = nextOrder;
  }

  const currentExcludes = uniqueStrings(current.LatestItemsExcludes);
  const managed = new Set(managedKeys);
  const nextExcludes = includeInSecondarySections
    ? currentExcludes.filter((key) => !managed.has(key))
    : uniqueStrings([...currentExcludes, ...managedKeys]);
  next.LatestItemsExcludes = nextExcludes;

  return {
    changed:
      !arraysEqual(currentOrder, nextOrder) ||
      !arraysEqual(currentExcludes, nextExcludes),
    configuration: next,
    managedKeys,
  };
}

export async function syncLeavingSoonUserPreferences({
  providerLabel,
  config,
  movieLibraryName,
  seriesLibraryName,
  keepTogether = true,
  includeInSecondarySections = false,
  getVirtualFolders,
  getUsers,
  getUser,
  getUserViews,
  updateUserConfiguration,
  folderIdentifier = viewKey,
}) {
  const folders = await getVirtualFolders(config);
  const targetNames = new Set([
    String(movieLibraryName || "").trim().toLowerCase(),
    String(seriesLibraryName || "").trim().toLowerCase(),
  ].filter(Boolean));
  const hasAvailableTarget = folders.some((folder) =>
    targetNames.has(String(folder?.Name || "").trim().toLowerCase()) &&
    String(folderIdentifier(folder) || "").trim()
  );
  if (!hasAvailableTarget) {
    return { supported: true, updated: 0, unchanged: 0, skipped: 0, reason: "no-libraries" };
  }

  const users = await getUsers(config);
  const applied = [];
  let unchanged = 0;
  let skipped = 0;

  try {
    for (const user of users) {
      const [record, views] = await Promise.all([
        getUser(config, user.id),
        getUserViews(config, user.id),
      ]);
      const original = record?.Configuration && typeof record.Configuration === "object"
        ? structuredClone(record.Configuration)
        : null;
      if (!original) {
        skipped += 1;
        continue;
      }
      const update = buildLeavingSoonUserConfiguration({
        configuration: original,
        views,
        movieLibraryName,
        seriesLibraryName,
        primaryLibraryNames: config.SearchLibraries,
        keepTogether,
        includeInSecondarySections,
      });
      if (!update.changed) {
        unchanged += 1;
        continue;
      }
      await updateUserConfiguration(config, user.id, update.configuration);
      applied.push({ id: user.id, original });
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...applied].reverse()) {
      try {
        await updateUserConfiguration(config, entry.id, entry.original);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    const suffix = rollbackErrors.length > 0
      ? ` Rollback warnings: ${rollbackErrors.join("; ")}`
      : " Previous user changes were rolled back.";
    throw new Error(
      `${providerLabel} home screen preferences could not be synchronized: ${error.message}.${suffix}`,
    );
  }

  return {
    supported: true,
    updated: applied.length,
    unchanged,
    skipped,
  };
}
