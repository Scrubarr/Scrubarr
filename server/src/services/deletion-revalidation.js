import { evaluateCleanupItem } from "./scan-engine.js";
import { collectScanItems } from "./scan-sources.js";
import { activePendingItems } from "./pending-state.js";
import { isSameExclusion } from "./exclusions.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function providerIdsMatch(expected, actual) {
  const expectedEntries = Object.entries(
    expected && typeof expected === "object" ? expected : {},
  ).filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (expectedEntries.length === 0) return true;
  const actualEntries = Object.entries(
    actual && typeof actual === "object" ? actual : {},
  );
  return expectedEntries.every(([expectedKey, expectedValue]) => {
    const match = actualEntries.find(
      ([actualKey]) => actualKey.toLowerCase() === expectedKey.toLowerCase(),
    );
    return match && String(match[1]) === String(expectedValue);
  });
}

function deferred(item, code, message) {
  return {
    ...item,
    SkipCode: code,
    SkipMessage: message,
  };
}

function verifiedDeletionItem(pendingItem, currentItem) {
  return {
    ...pendingItem,
    Path: currentItem.ArrPath || currentItem.Path || pendingItem.Path || null,
    Arr: currentItem.Arr,
    ArrId: currentItem.ArrId,
    ProviderIds: currentItem.ProviderIds || pendingItem.ProviderIds || {},
    CurrentPath: currentItem.Path || null,
  };
}

export async function revalidateDuePendingItems({
  settings,
  pending = [],
  exclusions = [],
  dueItems = [],
  now = new Date(),
  collectItems = collectScanItems,
} = {}) {
  const due = asList(dueItems);
  if (due.length === 0) {
    return { allowedItems: [], deferredItems: [], warnings: [] };
  }

  let collected;
  try {
    collected = await collectItems(settings);
  } catch (error) {
    return {
      allowedItems: [],
      deferredItems: due.map((item) =>
        deferred(
          item,
          "revalidation-unavailable",
          `Deletion deferred because current media data could not be rechecked: ${error.message || "unknown error"}`,
        ),
      ),
      warnings: [error.message || "Current media data could not be rechecked."],
    };
  }

  const currentById = new Map(
    asList(collected?.items)
      .filter((item) => item?.ItemId)
      .map((item) => [String(item.ItemId), item]),
  );
  const activePending = activePendingItems(pending);
  const allowedItems = [];
  const deferredItems = [];

  for (const pendingItem of due) {
    const itemId = String(pendingItem.ItemId || "");
    const currentItem = itemId ? currentById.get(itemId) : null;
    if (!currentItem) {
      deferredItems.push(
        deferred(
          pendingItem,
          "media-server-item-not-found",
          "Deletion deferred because the item no longer appears in the configured media-server libraries.",
        ),
      );
      continue;
    }
    if (currentItem.Type !== pendingItem.Type) {
      deferredItems.push(
        deferred(
          pendingItem,
          "media-server-item-changed",
          "Deletion deferred because the media-server item type no longer matches the pending record.",
        ),
      );
      continue;
    }
    if (
      !pendingItem.Arr ||
      !Number.isInteger(pendingItem.ArrId) ||
      currentItem.Arr !== pendingItem.Arr ||
      Number(currentItem.ArrId) !== Number(pendingItem.ArrId) ||
      !providerIdsMatch(pendingItem.ProviderIds, currentItem.ProviderIds)
    ) {
      deferredItems.push(
        deferred(
          pendingItem,
          "arr-identity-changed",
          "Deletion deferred because the current Arr record no longer matches the pending item.",
        ),
      );
      continue;
    }

    const decision = evaluateCleanupItem({
      item: currentItem,
      settings,
      exclusions,
      activePending: activePending.filter(
        (tracked) => !isSameExclusion(tracked, pendingItem),
      ),
      pendingCounts: { Movie: 0, Series: 0 },
      selectedCounts: { Movie: 0, Series: 0 },
      ignoreLimits: true,
      now,
    });
    if (!decision.eligible) {
      deferredItems.push(
        deferred(
          pendingItem,
          decision.skip || "no-longer-eligible",
          "Deletion deferred because the item no longer matches the current cleanup rules.",
        ),
      );
      continue;
    }

    allowedItems.push(verifiedDeletionItem(pendingItem, currentItem));
  }

  return {
    allowedItems,
    deferredItems,
    warnings: asList(collected?.warnings).map(String),
  };
}
