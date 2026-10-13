import { DateTime } from "luxon";

export type RecurrenceFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "custom";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  interval_days?: number | null;
  anchor_date: string; // ISO date of the first visit (business-local)
  ends_on?: string | null;
};

/**
 * Returns the n-th occurrence date (0 = anchor). Monthly/quarterly occurrences keep the anchor's
 * day of month and clamp to the last day for shorter months (Jan 31 → Feb 28/29 → Mar 31),
 * so a clamp never drifts the series.
 */
export function nthOccurrence(rule: RecurrenceRule, n: number): string {
  const anchor = DateTime.fromISO(rule.anchor_date, { zone: "UTC" });
  if (!anchor.isValid) throw new Error("Invalid anchor date");
  switch (rule.frequency) {
    case "weekly":
      return anchor.plus({ days: 7 * n }).toISODate()!;
    case "biweekly":
      return anchor.plus({ days: 14 * n }).toISODate()!;
    case "custom": {
      if (!rule.interval_days || rule.interval_days < 1) throw new Error("Custom recurrence needs interval_days");
      return anchor.plus({ days: rule.interval_days * n }).toISODate()!;
    }
    case "monthly":
    case "quarterly": {
      const months = rule.frequency === "monthly" ? n : n * 3;
      // luxon's plus({months}) already clamps to the end of shorter months from the anchor.
      return anchor.plus({ months }).toISODate()!;
    }
  }
}

/** All occurrence dates in [from, through] (inclusive, ISO dates). */
export function occurrencesBetween(rule: RecurrenceRule, from: string, through: string): string[] {
  const out: string[] = [];
  const last = rule.ends_on && rule.ends_on < through ? rule.ends_on : through;
  for (let n = 0; n < 2000; n++) {
    const d = nthOccurrence(rule, n);
    if (d > last) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/**
 * Wall-clock start in the business zone → UTC start/end. Because we build each occurrence from its
 * local date + local time, a 9:00 AM series stays at 9:00 AM across daylight-saving changes.
 */
export function occurrenceWindow(date: string, startTime: string, durationMinutes: number, tz: string) {
  const start = DateTime.fromISO(`${date}T${startTime.slice(0, 5)}`, { zone: tz });
  if (!start.isValid) throw new Error(`Invalid occurrence ${date} ${startTime}`);
  const end = start.plus({ minutes: durationMinutes });
  return { starts_at: start.toUTC().toISO()!, ends_at: end.toUTC().toISO()! };
}

export function frequencyLabel(f: RecurrenceFrequency, intervalDays?: number | null): string {
  switch (f) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "custom":
      return `Every ${intervalDays ?? "?"} days`;
  }
}
