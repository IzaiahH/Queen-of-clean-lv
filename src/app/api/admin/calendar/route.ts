import { DateTime } from "luxon";
import { requireCap } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listAppointments } from "@/lib/server/admin-queries";
import { errorResponse, json } from "@/lib/server/http";

export async function GET(req: Request) {
  try {
    await requireCap("schedule.view");
    const u = new URL(req.url);
    const start = DateTime.fromISO(u.searchParams.get("start") ?? "");
    const end = DateTime.fromISO(u.searchParams.get("end") ?? "");
    if (!start.isValid || !end.isValid || end.diff(start, "days").days > 62) return json({ error: "Invalid range" }, 400);
    const statuses = u.searchParams.get("status")?.split(",").filter(Boolean);
    const rows = await listAppointments({
      from: start.toJSDate(), to: end.toJSDate(),
      status: statuses?.length ? statuses : undefined,
      cleanerId: u.searchParams.get("cleaner") || undefined,
      service: u.searchParams.get("service") || undefined,
      area: u.searchParams.get("area") || undefined,
      q: u.searchParams.get("q") || undefined,
    });
    const blocks = u.searchParams.get("blocks") === "0" ? [] : await db()<{ id: string; starts_at: Date; ends_at: Date; reason: string }[]>`
      select id, starts_at, ends_at, reason from blocked_periods where starts_at < ${end.toJSDate()} and ends_at > ${start.toJSDate()}`;
    const timeOff = u.searchParams.get("blocks") === "0" ? [] : await db()<{ id: string; starts_at: Date; ends_at: Date; full_name: string }[]>`
      select t.id, t.starts_at, t.ends_at, c.full_name from cleaner_time_off t join cleaners c on c.id = t.cleaner_id
       where t.starts_at < ${end.toJSDate()} and t.ends_at > ${start.toJSDate()}`;
    return json({
      events: [
        ...rows.map((a) => ({
          id: a.id,
          title: `${a.customer_name} · ${a.service_name}`,
          start: a.starts_at,
          end: a.ends_at,
          classNames: [`status-${a.status}`, a.needs_attention || a.open_request ? "needs-attention" : ""].filter(Boolean),
          editable: ["pending", "confirmed"].includes(a.status),
          extendedProps: { kind: "appointment", status: a.status, customer: a.customer_name, service: a.service_name, cleaners: a.cleaner_names, minutes: a.estimated_minutes, attention: a.needs_attention ?? (a.open_request ? `Customer ${a.open_request} request` : null), recurring: Boolean(a.series_id), area: a.area },
        })),
        ...blocks.map((b) => ({ id: `block-${b.id}`, title: `Blocked${b.reason ? `: ${b.reason}` : ""}`, start: b.starts_at, end: b.ends_at, classNames: ["status-blocked"], editable: false, extendedProps: { kind: "block", blockId: b.id } })),
        ...timeOff.map((t) => ({ id: `off-${t.id}`, title: `${t.full_name} — time off`, start: t.starts_at, end: t.ends_at, classNames: ["status-blocked"], editable: false, extendedProps: { kind: "timeoff" } })),
      ],
    });
  } catch (e) {
    return errorResponse(e);
  }
}
