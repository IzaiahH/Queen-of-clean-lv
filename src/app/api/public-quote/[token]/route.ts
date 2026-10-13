import { z } from "zod";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { listSlots } from "@/lib/scheduling/availability";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { quoteByToken } from "@/lib/server/public-lookup";
import { acceptQuoteByToken, bookFromQuoteToken } from "@/lib/server/quote-actions";
import { loadScheduleContext } from "@/lib/server/schedule";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { loadSettings } from "@/lib/server/settings";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("book"), slot_start: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal("slots"), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!(await rateLimit(`pq:${await clientIpHash()}`, 60, 600))) return json({ error: "Too many requests." }, 429);
    const parsed = body.safeParse(await readJson(req).catch(() => null));
    if (!parsed.success) return json({ error: "Invalid request" }, 422);
    const b = parsed.data;
    if (b.action === "accept") {
      const r = await acceptQuoteByToken(token);
      return r.ok ? json(r) : json(r, 409);
    }
    if (b.action === "book") {
      const r = await bookFromQuoteToken(token, b.slot_start);
      return r.ok ? json(r, 201) : json(r, 409);
    }
    const q = await quoteByToken(token);
    if (!q) return json({ error: "Not found" }, 404);
    const settings = await loadSettings();
    const tz = settings.booking.timezone;
    const today = DateTime.now().setZone(tz).startOf("day");
    const from = b.from ? DateTime.max(DateTime.fromISO(b.from, { zone: tz }), today) : today;
    const ctx = await loadScheduleContext(db(), settings, from, from.plus({ days: 7 }));
    const days = listSlots(ctx, from.toISODate()!, 7, q.estimated_minutes, { serviceSlug: q.service_slug });
    return json({ ok: true, days: days.map((d) => ({ date: d.date, label: d.label, slots: d.slots.map((s) => ({ start: s.start, label: s.label })) })) });
  } catch (e) {
    return errorResponse(e);
  }
}
