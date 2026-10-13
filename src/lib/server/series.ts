import "server-only";
import { DateTime } from "luxon";
import { db, type Tx, type TxSql } from "@/lib/db";
import { checkCleaner, checkSlot } from "@/lib/scheduling/availability";
import { occurrencesBetween, occurrenceWindow, type RecurrenceFrequency } from "@/lib/scheduling/recurrence";
import { audit, SYSTEM_ACTOR, type Actor } from "./audit";
import type { ActionResult } from "./appointments";
import { loadScheduleContext, lockSchedule, recordChange } from "./schedule";
import { loadSettings } from "./settings";
import { newReference, newToken, sha256 } from "./security";

export type SeriesRow = {
  id: string;
  customer_id: string;
  property_id: string;
  service_slug: string;
  quote_id: string | null;
  frequency: RecurrenceFrequency;
  interval_days: number | null;
  anchor_date: string;
  start_time: string;
  duration_minutes: number;
  price_cents: number;
  cleaner_ids: string[];
  status: "active" | "paused" | "cancelled";
  ends_on: string | null;
  generated_through: string | null;
  notes: string;
};

export type SeriesInput = {
  customer_id: string;
  property_id: string;
  service_slug: string;
  frequency: RecurrenceFrequency;
  interval_days: number | null;
  anchor_date: string;
  start_time: string;
  duration_minutes: number;
  price_cents: number;
  cleaner_ids: string[];
  quote_id?: string | null;
  notes?: string;
};

/**
 * Creates any missing occurrences up to the horizon. Safe to run any number of times:
 * (series_id, occurrence_date) is unique, so an existing visit — including a skipped or
 * rescheduled one — is never duplicated or recreated. Conflicts are flagged, never overbooked.
 */
export async function generateOccurrences(tx: TxSql, seriesId: string, opts: { horizonWeeks?: number; actor?: Actor } = {}) {
  const settings = await loadSettings(tx);
  const tz = settings.booking.timezone;
  const [s] = await tx<SeriesRow[]>`select * from recurring_series where id = ${seriesId} for update`;
  if (!s || s.status !== "active") return { created: 0, flagged: 0 };
  const today = DateTime.now().setZone(tz).toISODate()!;
  const through = DateTime.now().setZone(tz).plus({ weeks: opts.horizonWeeks ?? settings.recurring.horizon_weeks }).toISODate()!;
  const from = s.anchor_date > today ? s.anchor_date : today;
  const dates = occurrencesBetween({ frequency: s.frequency, interval_days: s.interval_days, anchor_date: s.anchor_date, ends_on: s.ends_on }, from, through);
  if (dates.length === 0) return { created: 0, flagged: 0 };

  const ctx = await loadScheduleContext(tx, settings, DateTime.fromISO(dates[0], { zone: tz }), DateTime.fromISO(dates[dates.length - 1], { zone: tz }).plus({ days: 1 }));
  const [prop] = await tx<{ access_instructions: string }[]>`select access_instructions from properties where id = ${s.property_id}`;
  let created = 0;
  let flagged = 0;
  for (const date of dates) {
    const w = occurrenceWindow(date, s.start_time, s.duration_minutes, tz);
    const start = DateTime.fromISO(w.starts_at);
    const end = DateTime.fromISO(w.ends_at);
    const inserted = await tx<{ id: string }[]>`
      insert into appointments (reference, customer_id, property_id, service_slug, quote_id, series_id, occurrence_date, starts_at, ends_at,
                                status, source, frequency, agreed_price_cents, estimated_minutes, access_instructions, manage_token_hash)
      values (${newReference("QC")}, ${s.customer_id}, ${s.property_id}, ${s.service_slug}, ${s.quote_id}, ${s.id}, ${date}, ${w.starts_at}, ${w.ends_at},
              'confirmed', 'recurring', ${s.frequency}, ${s.price_cents}, ${s.duration_minutes}, ${prop?.access_instructions ?? ""}, ${sha256(newToken())})
      on conflict (series_id, occurrence_date) do nothing
      returning id`;
    if (inserted.length === 0) continue;
    const id = inserted[0].id;
    created++;

    const problems: string[] = [];
    const slot = checkSlot(ctx, start, end, { serviceSlug: s.service_slug, excludeAppointmentId: id });
    problems.push(...slot.problems.filter((p) => !p.startsWith("No cleaner") || s.cleaner_ids.length === 0));
    const assigned: string[] = [];
    for (const cid of s.cleaner_ids) {
      const c = ctx.cleaners.find((x) => x.id === cid);
      const check = c ? checkCleaner(ctx, c, start, end, { excludeAppointmentId: id }) : { ok: false, problems: ["Series cleaner is inactive"] };
      if (!check.ok) {
        problems.push(...check.problems);
        continue;
      }
      try {
        await tx.savepoint(async (sp) => {
          await sp`insert into appointment_assignments (appointment_id, cleaner_id) values (${id}, ${cid})`;
        });
        assigned.push(cid);
      } catch {
        problems.push("Series cleaner is already booked at this time");
      }
    }
    // Keep the in-memory context current so later occurrences in this run see this one.
    ctx.busy.push({ id, starts_at: w.starts_at, ends_at: w.ends_at, cleaner_ids: assigned });
    if (problems.length) {
      flagged++;
      await tx`update appointments set needs_attention = ${`Recurring visit conflict: ${[...new Set(problems)].join("; ")}`} where id = ${id}`;
    }
    await recordChange(tx, id, "created", opts.actor ?? SYSTEM_ACTOR, null, { status: "confirmed", starts_at: w.starts_at }, "Generated from recurring schedule");
  }
  await tx`update recurring_series set generated_through = greatest(coalesce(generated_through, ${through}::date), ${through}::date) where id = ${s.id}`;
  return { created, flagged };
}

export async function generateAllSeries(actor: Actor = SYSTEM_ACTOR) {
  const sql = db();
  const series = await sql<{ id: string }[]>`select id from recurring_series where status = 'active'`;
  let created = 0;
  let flagged = 0;
  for (const s of series) {
    const r = await sql.begin(async (tx) => {
      await lockSchedule(tx);
      return generateOccurrences(tx, s.id, { actor });
    });
    created += r.created;
    flagged += r.flagged;
  }
  return { series: series.length, created, flagged };
}

export async function createSeries(actor: Actor, input: SeriesInput, firstAppointmentId?: string): Promise<ActionResult<{ id: string; created: number; flagged: number }>> {
  if (input.frequency === "custom" && !input.interval_days) return { ok: false, error: "Enter the number of days between visits" };
  const sql = db();
  return sql.begin(async (tx) => {
    await lockSchedule(tx);
    const [prop] = await tx`select 1 from properties where id = ${input.property_id} and customer_id = ${input.customer_id} and address_line1 is not null`;
    if (!prop) return { ok: false as const, error: "Choose a property with a street address" };
    const [row] = await tx<{ id: string }[]>`
      insert into recurring_series (customer_id, property_id, service_slug, quote_id, frequency, interval_days, anchor_date, start_time,
                                    duration_minutes, price_cents, cleaner_ids, notes, created_by)
      values (${input.customer_id}, ${input.property_id}, ${input.service_slug}, ${input.quote_id ?? null}, ${input.frequency},
              ${input.frequency === "custom" ? input.interval_days : null}, ${input.anchor_date}, ${input.start_time}, ${input.duration_minutes},
              ${input.price_cents}, ${input.cleaner_ids}, ${input.notes ?? ""}, ${actor.id})
      returning id`;
    if (firstAppointmentId) {
      // The confirmed first visit becomes occurrence #0 so it isn't generated twice.
      await tx`update appointments set series_id = ${row.id}, occurrence_date = ${input.anchor_date}, frequency = ${input.frequency}
               where id = ${firstAppointmentId} and series_id is null`;
    }
    const r = await generateOccurrences(tx, row.id, { actor });
    await tx`update customers set status = 'active', customer_since = coalesce(customer_since, current_date) where id = ${input.customer_id} and status in ('lead','inactive')`;
    await audit(actor, "series.create", "recurring_series", row.id, { ...r }, tx);
    return {
      ok: true as const,
      message: `Recurring schedule created with ${r.created} upcoming visit${r.created === 1 ? "" : "s"}${r.flagged ? ` (${r.flagged} need attention)` : ""}.`,
      data: { id: row.id, ...r },
    };
  });
}

/** Future visits generated from the series that nobody has edited, completed or cancelled. */
async function untouchedFuture(tx: Tx, seriesId: string, fromDate: string | null) {
  return tx<{ id: string }[]>`
    select a.id from appointments a
     where a.series_id = ${seriesId} and not a.is_exception and a.status in ('pending','confirmed') and a.starts_at > now()
       and (${fromDate}::date is null or a.occurrence_date >= ${fromDate}::date)
       and not exists (select 1 from job_records j where j.appointment_id = a.id)`;
}

export async function seriesImpact(seriesId: string, fromDate: string | null) {
  const sql = db();
  const untouched = await untouchedFuture(sql, seriesId, fromDate);
  const [{ edited }] = await sql<{ edited: number }[]>`
    select count(*)::int as edited from appointments
     where series_id = ${seriesId} and is_exception and status in ('pending','confirmed') and starts_at > now()
       and (${fromDate}::date is null or occurrence_date >= ${fromDate}::date)`;
  return { regenerated: untouched.length, kept: edited };
}

export async function setSeriesStatus(actor: Actor, seriesId: string, status: "active" | "paused" | "cancelled"): Promise<ActionResult> {
  const sql = db();
  return sql.begin(async (tx) => {
    await lockSchedule(tx);
    const [s] = await tx<SeriesRow[]>`select * from recurring_series where id = ${seriesId} for update`;
    if (!s) return { ok: false as const, error: "Recurring schedule not found" };
    if (s.status === "cancelled") return { ok: false as const, error: "This schedule was cancelled. Create a new one instead." };
    await tx`update recurring_series set status = ${status} where id = ${seriesId}`;
    const future = await untouchedFuture(tx, seriesId, null);
    let message = "";
    if (status === "paused") {
      // Remove generated-but-untouched visits; edited visits stay so nothing the customer agreed to disappears silently.
      if (future.length) await tx`delete from appointments where id = any(${future.map((f) => f.id)})`;
      message = `Schedule paused. ${future.length} upcoming generated visit(s) removed; individually edited visits were kept.`;
    } else if (status === "cancelled") {
      await tx`update appointments set status = 'cancelled', cancelled_reason = 'Recurring schedule cancelled'
               where series_id = ${seriesId} and status in ('pending','confirmed') and starts_at > now()`;
      message = "Schedule cancelled and all upcoming visits cancelled.";
    } else {
      const r = await generateOccurrences(tx, seriesId, { actor });
      message = `Schedule resumed with ${r.created} upcoming visit(s)${r.flagged ? `, ${r.flagged} need attention` : ""}.`;
    }
    await audit(actor, `series.${status}`, "recurring_series", seriesId, {}, tx);
    return { ok: true as const, message };
  });
}

/**
 * Edits a series for "this and future" (fromDate set) or "all upcoming" (fromDate null).
 * Untouched future visits are regenerated from the new pattern; individually edited visits are kept.
 */
export async function updateSeries(
  actor: Actor,
  seriesId: string,
  fromDate: string | null,
  changes: Partial<Pick<SeriesRow, "frequency" | "interval_days" | "start_time" | "duration_minutes" | "price_cents" | "cleaner_ids" | "notes">> & { anchor_date?: string },
): Promise<ActionResult> {
  const sql = db();
  return sql.begin(async (tx) => {
    await lockSchedule(tx);
    const [s] = await tx<SeriesRow[]>`select * from recurring_series where id = ${seriesId} for update`;
    if (!s) return { ok: false as const, error: "Recurring schedule not found" };
    if (s.status === "cancelled") return { ok: false as const, error: "This schedule was cancelled" };
    const next = { ...s, ...changes };
    if (next.frequency === "custom" && !next.interval_days) return { ok: false as const, error: "Enter the number of days between visits" };
    const future = await untouchedFuture(tx, seriesId, fromDate);
    if (future.length) await tx`delete from appointments where id = any(${future.map((f) => f.id)})`;

    let targetId = seriesId;
    if (fromDate) {
      // Split: the old series ends the day before; a new series continues with the new pattern.
      const endOld = DateTime.fromISO(fromDate).minus({ days: 1 }).toISODate()!;
      await tx`update recurring_series set ends_on = ${endOld} where id = ${seriesId}`;
      const [row] = await tx<{ id: string }[]>`
        insert into recurring_series (customer_id, property_id, service_slug, quote_id, frequency, interval_days, anchor_date, start_time,
                                      duration_minutes, price_cents, cleaner_ids, notes, status, created_by, ends_on)
        values (${s.customer_id}, ${s.property_id}, ${s.service_slug}, ${s.quote_id}, ${next.frequency}, ${next.frequency === "custom" ? next.interval_days : null},
                ${changes.anchor_date ?? fromDate}, ${next.start_time}, ${next.duration_minutes}, ${next.price_cents}, ${next.cleaner_ids}, ${next.notes}, 'active',
                ${actor.id}, ${s.ends_on})
        returning id`;
      targetId = row.id;
      // Individually edited future visits move to the new series so their dates aren't generated twice.
      await tx`update appointments set series_id = ${row.id} where series_id = ${seriesId} and occurrence_date >= ${fromDate}::date`;
    } else {
      await tx`update recurring_series set frequency = ${next.frequency}, interval_days = ${next.frequency === "custom" ? next.interval_days : null},
                 start_time = ${next.start_time}, duration_minutes = ${next.duration_minutes}, price_cents = ${next.price_cents},
                 cleaner_ids = ${next.cleaner_ids}, notes = ${next.notes}, anchor_date = ${changes.anchor_date ?? s.anchor_date}
               where id = ${seriesId}`;
    }
    const r = await generateOccurrences(tx, targetId, { actor });
    await audit(actor, "series.update", "recurring_series", seriesId, { fromDate, changes, regenerated: future.length, ...r }, tx);
    return {
      ok: true as const,
      message: `Schedule updated. ${future.length} upcoming visit(s) replaced with ${r.created} regenerated visit(s)${r.flagged ? ` (${r.flagged} need attention)` : ""}. Individually edited visits were kept.`,
    };
  });
}
