import { DateTime } from "luxon";

export const DEFAULT_TZ = "America/Los_Angeles";

export function toZoned(value: Date | string, tz = DEFAULT_TZ): DateTime {
  const dt = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);
  return dt.setZone(tz);
}

export function formatDateTime(value: Date | string, tz = DEFAULT_TZ): string {
  return toZoned(value, tz).toFormat("ccc, LLL d, yyyy 'at' h:mm a");
}

export function formatDate(value: Date | string, tz = DEFAULT_TZ): string {
  return toZoned(value, tz).toFormat("ccc, LLL d, yyyy");
}

export function formatTime(value: Date | string, tz = DEFAULT_TZ): string {
  return toZoned(value, tz).toFormat("h:mm a");
}

export function formatTimeRange(start: Date | string, end: Date | string, tz = DEFAULT_TZ): string {
  return `${formatTime(start, tz)} – ${formatTime(end, tz)}`;
}

/** Wall-clock date ("2026-10-14") + time ("09:30") in the business zone → UTC instant. */
export function localToInstant(date: string, time: string, tz = DEFAULT_TZ): DateTime {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid local date/time: ${date} ${time}`);
  return dt;
}

export function todayLocal(tz = DEFAULT_TZ, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(tz).toISODate()!;
}

export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr${h > 1 ? "s" : ""}` : `${h} hr ${m} min`;
}
