import { addDaysToDateOnly, daysSinceDateOnly } from "./date-utils.js";
import { activePendingItems } from "./pending-state.js";

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function compactItem(item) {
  return {
    ItemId: item.ItemId,
    Title: item.Title,
    Type: item.Type,
    Year: item.Year || null,
  };
}

export function pendingDeletionSummary({
  pending,
  settings,
  timezone = "UTC",
  now = new Date(),
} = {}) {
  const daysUntilDeletion = Number(settings?.DeletionSchedule?.DaysUntilDeletion);
  const validWindow = Number.isInteger(daysUntilDeletion) && daysUntilDeletion >= 1;
  const items = activePendingItems(asList(pending)).map((item) => {
    const ageDays = daysSinceDateOnly(item.MarkedDate, now, timezone);
    const deletionDate = validWindow
      ? addDaysToDateOnly(item.MarkedDate, daysUntilDeletion)
      : null;
    const daysRemaining = validWindow && ageDays !== null
      ? Math.max(0, daysUntilDeletion - ageDays)
      : null;
    const daysOverdue = validWindow && ageDays !== null
      ? Math.max(0, ageDays - daysUntilDeletion)
      : null;

    return {
      ...compactItem(item),
      MarkedDate: item.MarkedDate || null,
      PendingAgeDays: ageDays,
      DeletionDate: deletionDate,
      DaysRemaining: daysRemaining,
      DaysOverdue: daysOverdue,
      Eligible: daysRemaining === 0,
    };
  });

  const datedItems = items
    .filter((item) => item.DeletionDate)
    .sort((left, right) =>
      left.DeletionDate.localeCompare(right.DeletionDate) ||
      String(left.Title || "").localeCompare(String(right.Title || "")),
    );
  const nextEligible = datedItems[0] || null;
  const nextEligibleDate = nextEligible?.DeletionDate || null;

  return {
    pendingTotal: items.length,
    daysUntilDeletion: validWindow ? daysUntilDeletion : null,
    mode: settings?.CleanupRules?.DryRun === true ? "preview" : "live",
    expiredTotal: items.filter((item) => item.Eligible).length,
    nextEligible: nextEligible
      ? {
          date: nextEligibleDate,
          daysRemaining: nextEligible.DaysRemaining,
          daysOverdue: nextEligible.DaysOverdue,
          count: datedItems.filter((item) => item.DeletionDate === nextEligibleDate).length,
          item: compactItem(nextEligible),
        }
      : null,
    items,
  };
}
