import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "@/lib/db";
import { listSlots } from "@/lib/scheduling/availability";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { priceFromProperty } from "@/lib/server/quotes";
import { loadScheduleContext } from "@/lib/server/schedule";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { loadSettings } from "@/lib/server/settings";
import { propertyInputSchema } from "@/lib/validation/booking";

const schema = z.object({
  property: propertyInputSchema,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.number().int().min(1).max(14).default(7),
});

/**
 * Real availability computed from the database. The job length comes from the server-side
 * estimate, never from the client. Cleaner identities are not exposed.
 */
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`avail:${await clientIpHash()}`, 120, 600))) return json({ error: "Too many requests. Please wait a few minutes." }, 429);
    const parsed = schema.safeParse(await readJson(req).catch(() => null));
    if (!parsed.success) return json({ error: "Invalid request" }, 422);
    const sql = db();
    const settings = await loadSettings(sql);
    const priced = await priceFromProperty(parsed.data.property, sql);
    if ("error" in priced) return json({ error: priced.error }, 422);
    const tz = settings.booking.timezone;
    const today = DateTime.now().setZone(tz).startOf("day");
    let from = parsed.data.from ? DateTime.fromISO(parsed.data.from, { zone: tz }) : today;
    if (from < today) from = today;
    const last = today.plus({ days: settings.booking.horizon_days });
    if (from > last) return json({ ok: true, days: [], duration_minutes: priced.result.estimated_minutes, tz, horizon_end: last.toISODate() });
    const days = Math.min(parsed.data.days, Math.max(1, Math.floor(last.diff(from, "days").days) + 1));
    const ctx = await loadScheduleContext(sql, settings, from, from.plus({ days }));
    const result = listSlots(ctx, from.toISODate()!, days, priced.result.estimated_minutes, { serviceSlug: parsed.data.property.service });
    return json({
      ok: true,
      tz,
      duration_minutes: priced.result.estimated_minutes,
      horizon_end: last.toISODate(),
      days: result.map((d) => ({ date: d.date, label: d.label, slots: d.slots.map((s) => ({ start: s.start, label: s.label })) })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
