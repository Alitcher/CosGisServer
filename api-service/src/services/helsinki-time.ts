/**
 * UTC timestamps from the import feeds -> Helsinki wall-clock date and time.
 *
 * Both feeds send ISO strings in UTC ("2026-11-21T08:00:00Z"). Slicing the
 * string is off by a day for anything starting late evening, and the hour is
 * 2-3 hours off, so convert through the Europe/Helsinki zone instead.
 */
const ZONE = "Europe/Helsinki";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** 'YYYY-MM-DD' in Helsinki, or null if unparsable. */
export function localDate(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? dateFmt.format(new Date(t)) : null;
}

/** 'HH:MM' in Helsinki, or null when unparsable or the value is date-only. */
export function localTime(iso: string): string | null {
  if (!iso.includes("T")) return null; // "2026-11-21" carries no time
  const t = Date.parse(iso);
  return Number.isFinite(t) ? timeFmt.format(new Date(t)) : null;
}
