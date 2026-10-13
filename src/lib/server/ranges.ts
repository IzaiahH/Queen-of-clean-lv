import "server-only";
import { DateTime } from "luxon";

export type RangeKey = "today" | "week" | "month" | "last_month" | "quarter" | "year" | "custom";

/** Business-local date ranges → UTC instants. `to` is exclusive. */
export function resolveRange(sp: { range?: string; from?: string; to?: string }, tz: string) {
  const now = DateTime.now().setZone(tz);
  const key = (sp.range ?? "month") as RangeKey;
  let from: DateTime;
  let to: DateTime;
  switch (key) {
    case "today": from = now.startOf("day"); to = from.plus({ days: 1 }); break;
    case "week": from = now.startOf("week"); to = from.plus({ weeks: 1 }); break;
    case "last_month": from = now.minus({ months: 1 }).startOf("month"); to = from.plus({ months: 1 }); break;
    case "quarter": from = now.startOf("quarter"); to = from.plus({ quarters: 1 }); break;
    case "year": from = now.startOf("year"); to = from.plus({ years: 1 }); break;
    case "custom": {
      const f = sp.from ? DateTime.fromISO(sp.from, { zone: tz }) : null;
      const t = sp.to ? DateTime.fromISO(sp.to, { zone: tz }) : null;
      if (f?.isValid && t?.isValid && t >= f) { from = f.startOf("day"); to = t.startOf("day").plus({ days: 1 }); break; }
      from = now.startOf("month"); to = from.plus({ months: 1 }); break;
    }
    default: from = now.startOf("month"); to = from.plus({ months: 1 });
  }
  return { key, from: from.toJSDate(), to: to.toJSDate(), label: `${from.toFormat("LLL d, yyyy")} – ${to.minus({ days: 1 }).toFormat("LLL d, yyyy")}`, fromISO: from.toISODate()!, toISO: to.minus({ days: 1 }).toISODate()! };
}
