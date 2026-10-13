import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { listSlots } from "@/lib/scheduling/availability";
import { errorResponse, json } from "@/lib/server/http";
import { appointmentByToken } from "@/lib/server/public-lookup";
import { loadScheduleContext } from "@/lib/server/schedule";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { loadSettings } from "@/lib/server/settings";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!(await rateLimit(`manage-av:${await clientIpHash()}`, 60, 600))) return json({ error: "Too many requests." }, 429);
    const a = await appointmentByToken(token);
    if (!a) return json({ error: "Not found" }, 404);
    const settings = await loadSettings();
    const tz = settings.booking.timezone;
    const fromParam = new URL(req.url).searchParams.get("from");
    const today = DateTime.now().setZone(tz).startOf("day");
    const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? DateTime.max(DateTime.fromISO(fromParam, { zone: tz }), today) : today;
    const ctx = await loadScheduleContext(db(), settings, from, from.plus({ days: 7 }));
    // The customer's own booking shouldn't block a move to an overlapping time.
    ctx.busy = ctx.busy.filter((b) => b.id !== a.id);
    const days = listSlots(ctx, from.toISODate()!, 7, a.estimated_minutes, { serviceSlug: a.service_slug });
    return json({ ok: true, days: days.map((d) => ({ date: d.date, label: d.label, slots: d.slots.map((s) => ({ start: s.start, label: s.label })) })) });
  } catch (e) {
    return errorResponse(e);
  }
}
