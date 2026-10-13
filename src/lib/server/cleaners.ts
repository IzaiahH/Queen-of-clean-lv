import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, type Actor } from "./audit";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const cleanerInputSchema = z.object({
  full_name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.string().trim().toLowerCase().email().or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(40).transform((v) => v || null),
  active: z.boolean(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  capabilities: z.array(z.string().max(40)).max(20),
  worker_type: z.enum(["unspecified", "employee", "contractor", "owner", "other"]),
  pay_method: z.enum(["hourly", "per_job", "percent"]),
  pay_rate_cents: z.number().int().min(0).max(100_000),
  pay_percent: z.number().min(0).max(100),
  max_jobs_per_day: z.number().int().min(1).max(12).nullable(),
  private_notes: z.string().max(3000),
});
export type CleanerInput = z.input<typeof cleanerInputSchema>;

export const hoursSchema = z.array(z.object({ weekday: z.number().int().min(1).max(7), start_time: hhmm, end_time: hhmm })).max(21)
  .refine((rows) => rows.every((r) => r.end_time > r.start_time), "Each shift must end after it starts");

export async function listCleaners() {
  const rows = await db()<{
    id: string; full_name: string; email: string | null; phone: string | null; active: boolean; color: string; capabilities: string[]; worker_type: string;
    pay_method: string; pay_rate_cents: number; pay_percent: number; max_jobs_per_day: number | null;
    hours: { weekday: number; start_time: string; end_time: string }[]; jobs_week: number; minutes_week: number; jobs_30: number; next_off: Date | null; has_login: boolean;
  }[]>`
    select c.id, c.full_name, c.email, c.phone, c.active, c.color, c.capabilities, c.worker_type, c.pay_method, c.pay_rate_cents, c.pay_percent::float as pay_percent, c.max_jobs_per_day,
           coalesce((select json_agg(json_build_object('weekday', h.weekday, 'start_time', to_char(h.start_time, 'HH24:MI'), 'end_time', to_char(h.end_time, 'HH24:MI')) order by h.weekday, h.start_time)
                     from cleaner_working_hours h where h.cleaner_id = c.id), '[]') as hours,
           (select count(*)::int from appointment_assignments x join appointments a on a.id = x.appointment_id
             where x.cleaner_id = c.id and a.status in ('pending','confirmed','completed') and a.starts_at >= date_trunc('week', now()) and a.starts_at < date_trunc('week', now()) + interval '7 days') as jobs_week,
           (select coalesce(sum(a.estimated_minutes),0)::int from appointment_assignments x join appointments a on a.id = x.appointment_id
             where x.cleaner_id = c.id and a.status in ('pending','confirmed','completed') and a.starts_at >= date_trunc('week', now()) and a.starts_at < date_trunc('week', now()) + interval '7 days') as minutes_week,
           (select count(*)::int from labor_records l join appointments a on a.id = l.appointment_id where l.cleaner_id = c.id and a.starts_at > now() - interval '30 days') as jobs_30,
           (select min(starts_at) from cleaner_time_off t where t.cleaner_id = c.id and t.ends_at > now()) as next_off,
           exists (select 1 from profiles p where p.cleaner_id = c.id and p.active) as has_login
      from cleaners c order by c.active desc, c.full_name`;
  return Array.from(rows).map((r) => ({ ...r }));
}

export async function getCleaner(id: string) {
  const sql = db();
  const [c] = await sql<(z.output<typeof cleanerInputSchema> & { id: string; created_at: Date })[]>`
    select id, full_name, email, phone, active, color, capabilities, worker_type, pay_method, pay_rate_cents, pay_percent::float as pay_percent, max_jobs_per_day, private_notes, created_at
      from cleaners where id = ${id}`;
  if (!c) return null;
  const [hours, timeOff, upcoming, stats, login] = await Promise.all([
    sql<{ weekday: number; start_time: string; end_time: string }[]>`select weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time from cleaner_working_hours where cleaner_id = ${id} order by weekday, start_time`,
    sql<{ id: string; starts_at: Date; ends_at: Date; reason: string }[]>`select id, starts_at, ends_at, reason from cleaner_time_off where cleaner_id = ${id} and ends_at > now() - interval '30 days' order by starts_at`,
    sql<{ id: string; starts_at: Date; status: string; customer_name: string; service_name: string; estimated_minutes: number }[]>`
      select a.id, a.starts_at, a.status, cu.full_name as customer_name, coalesce(s.name, a.service_slug) as service_name, a.estimated_minutes
        from appointment_assignments x join appointments a on a.id = x.appointment_id join customers cu on cu.id = a.customer_id left join services s on s.slug = a.service_slug
       where x.cleaner_id = ${id} and a.starts_at > now() - interval '1 day' and a.status in ('pending','confirmed') order by a.starts_at limit 30`,
    sql<{ jobs: number; minutes: number; pay_cents: number }[]>`
      select count(*)::int as jobs, coalesce(sum(l.minutes),0)::int as minutes, coalesce(sum(l.pay_cents),0)::int as pay_cents
        from labor_records l join appointments a on a.id = l.appointment_id where l.cleaner_id = ${id} and a.starts_at > now() - interval '30 days'`,
    sql<{ email: string; active: boolean }[]>`select email, active from profiles where cleaner_id = ${id} limit 1`,
  ]);
  return {
    c: { ...c }, hours: Array.from(hours).map((h) => ({ ...h })), timeOff: Array.from(timeOff).map((t) => ({ ...t })),
    upcoming: Array.from(upcoming).map((u) => ({ ...u })), stats: { ...stats[0] }, login: login[0] ? { ...login[0] } : null,
  };
}

/** Creates or updates a cleaner. Pay fields are only written when `canPay` (owner/admin). */
export async function saveCleaner(actor: Actor, id: string | null, input: CleanerInput, canPay: boolean) {
  const d = cleanerInputSchema.parse(input);
  if (!id) {
    const [row] = await db()<{ id: string }[]>`
      insert into cleaners (full_name, email, phone, active, color, capabilities, worker_type, pay_method, pay_rate_cents, pay_percent, max_jobs_per_day, private_notes)
      values (${d.full_name}, ${d.email}, ${d.phone}, ${d.active}, ${d.color}, ${d.capabilities}, ${d.worker_type},
              ${canPay ? d.pay_method : "hourly"}, ${canPay ? d.pay_rate_cents : 0}, ${canPay ? d.pay_percent : 0}, ${d.max_jobs_per_day}, ${d.private_notes})
      returning id`;
    await audit(actor, "cleaner.create", "cleaner", row.id);
    return row.id;
  }
  if (canPay) {
    await db()`update cleaners set pay_method = ${d.pay_method}, pay_rate_cents = ${d.pay_rate_cents}, pay_percent = ${d.pay_percent} where id = ${id}`;
  }
  await db()`
    update cleaners set full_name = ${d.full_name}, email = ${d.email}, phone = ${d.phone}, active = ${d.active}, color = ${d.color}, capabilities = ${d.capabilities},
           worker_type = ${d.worker_type}, max_jobs_per_day = ${d.max_jobs_per_day}, private_notes = ${d.private_notes}
     where id = ${id}`;
  await audit(actor, "cleaner.update", "cleaner", id, { pay_changed: canPay });
  return id;
}

export async function saveHours(actor: Actor, cleanerId: string, rows: z.input<typeof hoursSchema>) {
  const d = hoursSchema.parse(rows);
  await db().begin(async (tx) => {
    await tx`delete from cleaner_working_hours where cleaner_id = ${cleanerId}`;
    for (const r of d) await tx`insert into cleaner_working_hours (cleaner_id, weekday, start_time, end_time) values (${cleanerId}, ${r.weekday}, ${r.start_time}, ${r.end_time})`;
    await audit(actor, "cleaner.hours", "cleaner", cleanerId, { rows: d.length }, tx);
  });
}
