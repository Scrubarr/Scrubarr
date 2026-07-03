const DAY_MS = 24 * 60 * 60 * 1000;

export function dateOnlyInTimezone(date, timezone) {
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

export function utcDateFromDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function daysSinceDateOnly(value, now, timezone) {
  const markedUtc = utcDateFromDateOnly(value);
  const todayUtc = utcDateFromDateOnly(dateOnlyInTimezone(now, timezone));
  if (markedUtc === null || todayUtc === null) return null;
  return Math.max(0, Math.floor((todayUtc - markedUtc) / DAY_MS));
}

export function addDaysToDateOnly(value, days) {
  const start = utcDateFromDateOnly(value);
  if (start === null || !Number.isInteger(days)) return null;
  return new Date(start + days * DAY_MS).toISOString().slice(0, 10);
}
