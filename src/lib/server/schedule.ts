import "server-only";
import { DateTime } from "luxon";
import type { Tx } from "@/lib/db";
import type { ScheduleContext, SchedulingConfig } from "@/lib/scheduling/availability";
import type { Settings } from "@/lib/settings/schema";

export const ACTIVE_STATUSES = ["pending", "confirmed", "completed"] as const;

export function schedulingConfig(settings: Settings): SchedulingConfig {
  const b = settings.booking;
  return {
    tz: b.timezone,
    operating_hours: b.operating_hours,
    slot_interval_minutes: b.slot_interval_minutes,
    lead_time_hours: b.lead_time_hours,
    travel_buffer_minutes: b.travel_buffer_minutes,
    max_jobs_per_day: b.max_jobs_per_day,
    horizon_days: b.horizon_days,
  };
}

/** Loads everything availability depends on for [from, to), padded by a day on each side. */
export async function loadScheduleContext(tx: Tx, settings: Settings, from: DateTime, to: DateTime): Promise<ScheduleContext> {
  const lo = from.minus({ days: 1 }).toJSDate();
  const hi = to.plus({ days: 1 }).toJSDate();
  const [cleaners, hours, timeOff, busy, blocked] = await Promise.all([
    tx<{ id: string; full_name: string; capabilities: string[]; max_jobs_per_day: number | null }[]>`
      select id, full_name, capabilities, max_jobs_per_day from cleaners where active order by full_name`,
    tx<{ cleaner_id: string; weekday: number; start_time: string; end_time: string }[]>`
      select cleaner_id, weekday, start_time::text, end_time::text from cleaner_working_hours`,
    tx<{ cleaner_id: string; starts_at: Date; ends_at: Date }[]>`
      select cleaner_id, starts_at, ends_at from cleaner_time_off where starts_at < ${hi} and ends_at > ${lo}`,
    tx<{ id: string; starts_at: Date; ends_at: Date; cleaner_ids: string[] | null }[]>`
      select a.id, a.starts_at, a.ends_at,
             array_remove(array_agg(aa.cleaner_id), null) as cleaner_ids
        from appointments a
        left join appointment_assignments aa on aa.appointment_id = a.id
       where a.status in ('pending','confirmed','completed') and a.starts_at < ${hi} and a.ends_at > ${lo}
       group by a.id`,
    tx<{ starts_at: Date; ends_at: Date; reason: string }[]>`
      select starts_at, ends_at, reason from blocked_periods where starts_at < ${hi} and ends_at > ${lo}`,
  ]);
  return {
    config: schedulingConfig(settings),
    cleaners: cleaners.map((c) => ({
      id: c.id,
      name: c.full_name,
      capabilities: c.capabilities,
      max_jobs_per_day: c.max_jobs_per_day,
      hours: hours.filter((h) => h.cleaner_id === c.id).map((h) => ({ weekday: h.weekday, start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) })),
      time_off: timeOff.filter((t) => t.cleaner_id === c.id).map((t) => ({ starts_at: t.starts_at.toISOString(), ends_at: t.ends_at.toISOString() })),
    })),
    busy: busy.map((b) => ({ id: b.id, starts_at: b.starts_at.toISOString(), ends_at: b.ends_at.toISOString(), cleaner_ids: b.cleaner_ids ?? [] })),
    blocked: blocked.map((b) => ({ starts_at: b.starts_at.toISOString(), ends_at: b.ends_at.toISOString(), reason: b.reason })),
  };
}

/** Serializes all booking writes. Small business volume makes one global lock simple and safe. */
export async function lockSchedule(tx: Tx) {
  await tx`select pg_advisory_xact_lock(7340211)`;
}

export function isExclusionViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "23P01";
}

export async function recordChange(
  tx: Tx,
  appointmentId: string,
  kind: string,
  actor: { id: string | null; label: string },
  from: unknown,
  to: unknown,
  note = "",
) {
  await tx`
    insert into appointment_changes (appointment_id, kind, from_value, to_value, note, actor_profile_id, actor_label)
    values (${appointmentId}, ${kind}, ${from === undefined ? null : tx.json(from as never)}, ${to === undefined ? null : tx.json(to as never)},
            ${note}, ${actor.id}, ${actor.label})`;
}

