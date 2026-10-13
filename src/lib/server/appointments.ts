import "server-only";
import { DateTime } from "luxon";
import { db, type Tx } from "@/lib/db";
import { checkCleaner, checkSlot } from "@/lib/scheduling/availability";
import { laborPay, type PayMethod } from "@/lib/finance/calc";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { audit, type Actor } from "./audit";
import { appUrl, sendTemplatedEmail, type SendResult } from "./email";
import { isExclusionViolation, loadScheduleContext, lockSchedule, recordChange } from "./schedule";
import { loadSettings } from "./settings";
import { newReference, newToken, sha256 } from "./security";

export type ActionResult<T = unknown> =
  | { ok: true; message: string; data?: T; email?: SendResult | null }
  | { ok: false; error: string; conflicts?: string[] };

type ApptCore = {
  id: string;
  reference: string;
  status: string;
  starts_at: Date;
  ends_at: Date;
  estimated_minutes: number;
  service_slug: string;
  customer_id: string;
  series_id: string | null;
  quote_id: string | null;
  agreed_price_cents: number;
  customer_email: string | null;
  customer_name: string;
  service_name: string;
};

async function loadCore(tx: Tx, id: string): Promise<ApptCore | null> {
  const [row] = await tx<ApptCore[]>`
    select a.id, a.reference, a.status, a.starts_at, a.ends_at, a.estimated_minutes, a.service_slug, a.customer_id, a.series_id,
           a.quote_id, a.agreed_price_cents, c.email as customer_email, c.full_name as customer_name, coalesce(s.name, a.service_slug) as service_name
      from appointments a
      join customers c on c.id = a.customer_id
      left join services s on s.slug = a.service_slug
     where a.id = ${id}
     for update of a`;
  return row ?? null;
}

/** Customer-facing manage link: we only store its hash, so a fresh link is issued with each email. */
async function freshManageUrl(tx: Tx, id: string): Promise<string> {
  const token = newToken();
  await tx`update appointments set manage_token_hash = ${sha256(token)} where id = ${id}`;
  return appUrl(`/manage/${token}`);
}

async function emailCustomer(template: string, a: ApptCore, extra: Record<string, string> = {}): Promise<SendResult> {
  const sql = db();
  const settings = await loadSettings(sql);
  const manage = await freshManageUrl(sql, a.id);
  return sendTemplatedEmail(template, a.customer_email, {
    first_name: a.customer_name.split(/\s+/)[0],
    reference: a.reference,
    service: a.service_name,
    date_time: formatDateTime(a.starts_at, settings.booking.timezone),
    date: DateTime.fromJSDate(a.starts_at).setZone(settings.booking.timezone).toFormat("ccc, LLL d"),
    price: formatCents(a.agreed_price_cents),
    status: a.status,
    manage_url: manage,
    cancellation_policy: settings.policies.cancellation_policy,
    message: "",
    ...extra,
  }, { customer_id: a.customer_id, appointment_id: a.id });
}

const allowed: Record<string, string[]> = {
  confirm: ["pending"],
  decline: ["pending"],
  cancel: ["pending", "confirmed"],
  complete: ["confirmed", "pending", "completed"],
  no_show: ["confirmed"],
  reopen: ["cancelled", "declined", "no_show"],
};

export async function confirmAppointment(id: string, actor: Actor, notify = true): Promise<ActionResult> {
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (!allowed.confirm.includes(a.status)) return { ok: false as const, error: `A ${a.status} appointment can't be confirmed` };
    await tx`update appointments set status = 'confirmed', needs_attention = null where id = ${id}`;
    await tx`update customers set status = 'active', customer_since = coalesce(customer_since, current_date) where id = ${a.customer_id} and status in ('lead','inactive')`;
    if (a.quote_id) await tx`update quotes set status = 'accepted', accepted_at = coalesce(accepted_at, now()) where id = ${a.quote_id} and status in ('draft','sent','pending_customer')`;
    await recordChange(tx, id, "status", actor, { status: a.status }, { status: "confirmed" });
    await audit(actor, "appointment.confirm", "appointment", id, {}, tx);
    return { ok: true as const, a: { ...a, status: "confirmed" } };
  });
  if (!res.ok) return res;
  const email = notify ? await emailCustomer("booking_confirmed", res.a) : null;
  return { ok: true, message: "Appointment confirmed.", email };
}

/** Staff-created bookings send nothing automatically; this sends (or re-sends) the confirmation on request. */
export async function sendConfirmation(id: string, actor: Actor): Promise<ActionResult> {
  const a = await db().begin((tx) => loadCore(tx, id));
  if (!a) return { ok: false, error: "Appointment not found" };
  if (a.status !== "confirmed") return { ok: false, error: "Only confirmed appointments can be sent a confirmation" };
  const email = await emailCustomer("booking_confirmed", a);
  await audit(actor, "appointment.send_confirmation", "appointment", id, { status: email.status });
  if (email.status !== "sent") return { ok: false, error: `Confirmation was not sent: ${email.error ?? email.status}. It's logged in the history; retry from there.` };
  return { ok: true, message: "Confirmation email sent.", email };
}

export async function declineAppointment(id: string, actor: Actor, message: string, notify = true): Promise<ActionResult> {
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (!allowed.decline.includes(a.status)) return { ok: false as const, error: `A ${a.status} appointment can't be declined` };
    await tx`update appointments set status = 'declined', cancelled_reason = ${message || "Declined"}, needs_attention = null where id = ${id}`;
    await recordChange(tx, id, "status", actor, { status: a.status }, { status: "declined" }, message);
    await audit(actor, "appointment.decline", "appointment", id, { message }, tx);
    return { ok: true as const, a };
  });
  if (!res.ok) return res;
  const email = notify ? await emailCustomer("booking_declined", res.a, { message }) : null;
  return { ok: true, message: "Request declined. The time is free again.", email };
}

export async function cancelAppointment(id: string, actor: Actor, reason: string, notify = true, skip = false): Promise<ActionResult> {
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (!allowed.cancel.includes(a.status)) return { ok: false as const, error: `A ${a.status} appointment can't be cancelled` };
    const why = skip ? `Skipped${reason ? `: ${reason}` : ""} (series continues)` : reason || "Cancelled";
    await tx`update appointments set status = 'cancelled', cancelled_reason = ${why}, needs_attention = null where id = ${id}`;
    await tx`update customer_requests set status = 'approved', resolved_at = now(), resolved_by = ${actor.id} where appointment_id = ${id} and status = 'open' and kind = 'cancel'`;
    await recordChange(tx, id, skip ? "skip" : "status", actor, { status: a.status }, { status: "cancelled" }, why);
    await audit(actor, skip ? "appointment.skip" : "appointment.cancel", "appointment", id, { reason }, tx);
    return { ok: true as const, a };
  });
  if (!res.ok) return res;
  const email = notify ? await emailCustomer("booking_cancelled", res.a, { message: reason }) : null;
  return { ok: true, message: skip ? "Visit skipped. The rest of the series is unchanged." : "Appointment cancelled. The time is free again.", email };
}

export async function setStatusSimple(id: string, actor: Actor, to: "no_show" | "pending"): Promise<ActionResult> {
  const sql = db();
  return sql.begin(async (tx) => {
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (to === "no_show" && !allowed.no_show.includes(a.status)) return { ok: false as const, error: "Only confirmed appointments can be marked as a no-show" };
    if (to === "pending" && !allowed.reopen.includes(a.status)) return { ok: false as const, error: "Only cancelled or declined appointments can be reopened" };
    if (to === "pending") {
      // Reopening must not overlap anything that took the slot meanwhile.
      await lockSchedule(tx);
      const settings = await loadSettings(tx);
      const ctx = await loadScheduleContext(tx, settings, DateTime.fromJSDate(a.starts_at), DateTime.fromJSDate(a.ends_at));
      const s = checkSlot(ctx, DateTime.fromJSDate(a.starts_at), DateTime.fromJSDate(a.ends_at), { excludeAppointmentId: id, serviceSlug: a.service_slug });
      if (!s.ok) return { ok: false as const, error: "That time is no longer free", conflicts: s.problems };
    }
    try {
      await tx.savepoint(async (sp) => {
        await sp`update appointments set status = ${to} where id = ${id}`;
      });
    } catch (e) {
      if (isExclusionViolation(e)) return { ok: false as const, error: "The assigned cleaner is now booked at that time" };
      throw e;
    }
    await recordChange(tx, id, "status", actor, { status: a.status }, { status: to });
    await audit(actor, `appointment.${to}`, "appointment", id, {}, tx);
    return { ok: true as const, message: to === "no_show" ? "Marked as a no-show." : "Reopened as pending." };
  });
}

/**
 * Moves an appointment. Soft problems (outside hours, daily limit, blocked time) are returned as
 * conflicts so the admin can review them and save anyway; a cleaner double booking is never allowed.
 */
export async function rescheduleAppointment(
  id: string,
  actor: Actor,
  input: { starts_at: string; duration_minutes?: number; force?: boolean; notify?: boolean; note?: string },
): Promise<ActionResult> {
  const sql = db();
  const start = DateTime.fromISO(input.starts_at);
  if (!start.isValid) return { ok: false, error: "Invalid date/time" };
  const res = await sql.begin(async (tx) => {
    await lockSchedule(tx);
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (!["pending", "confirmed"].includes(a.status)) return { ok: false as const, error: `A ${a.status} appointment can't be rescheduled` };
    const minutes = input.duration_minutes ?? Math.round((a.ends_at.getTime() - a.starts_at.getTime()) / 60000);
    const end = start.plus({ minutes });
    const settings = await loadSettings(tx);
    const ctx = await loadScheduleContext(tx, settings, start, end);
    const assigned = await tx<{ cleaner_id: string }[]>`select cleaner_id from appointment_assignments where appointment_id = ${id}`;
    const problems: string[] = [];
    const slot = checkSlot(ctx, start, end, { excludeAppointmentId: id, serviceSlug: a.service_slug });
    if (assigned.length === 0) problems.push(...slot.problems);
    else {
      problems.push(...slot.problems.filter((p) => !p.startsWith("No cleaner")));
      for (const { cleaner_id } of assigned) {
        const c = ctx.cleaners.find((x) => x.id === cleaner_id);
        if (c) problems.push(...checkCleaner(ctx, c, start, end, { excludeAppointmentId: id }).problems);
      }
    }
    if (problems.length && !input.force) return { ok: false as const, error: "This time has conflicts", conflicts: [...new Set(problems)] };
    try {
      await tx.savepoint(async (sp) => {
        await sp`update appointments set starts_at = ${start.toJSDate()}, ends_at = ${end.toJSDate()}, estimated_minutes = ${minutes},
                   is_exception = (series_id is not null) where id = ${id}`;
      });
    } catch (e) {
      if (isExclusionViolation(e)) return { ok: false as const, error: "An assigned cleaner already has a job at that time. Change the cleaner first." };
      throw e;
    }
    await tx`update customer_requests set status = 'approved', resolved_at = now(), resolved_by = ${actor.id} where appointment_id = ${id} and status = 'open' and kind = 'reschedule'`;
    await tx`update appointments set needs_attention = null where id = ${id} and needs_attention like 'Customer asked%'`;
    await recordChange(tx, id, "reschedule", actor, { starts_at: a.starts_at, ends_at: a.ends_at }, { starts_at: start.toISO(), ends_at: end.toISO() },
      [input.note, problems.length ? `Saved despite: ${problems.join("; ")}` : ""].filter(Boolean).join(" — "));
    await audit(actor, "appointment.reschedule", "appointment", id, { to: start.toISO(), forced: problems.length > 0 }, tx);
    return { ok: true as const, a: { ...a, starts_at: start.toJSDate(), ends_at: end.toJSDate() } };
  });
  if (!res.ok) return res;
  const email = input.notify ? await emailCustomer("booking_rescheduled", res.a) : null;
  return { ok: true, message: "Appointment moved.", email };
}

export async function assignCleaners(id: string, actor: Actor, cleanerIds: string[], force = false): Promise<ActionResult> {
  const sql = db();
  return sql.begin(async (tx) => {
    await lockSchedule(tx);
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    const settings = await loadSettings(tx);
    const start = DateTime.fromJSDate(a.starts_at);
    const end = DateTime.fromJSDate(a.ends_at);
    const ctx = await loadScheduleContext(tx, settings, start, end);
    const problems: string[] = [];
    for (const cid of cleanerIds) {
      const c = ctx.cleaners.find((x) => x.id === cid);
      if (!c) {
        problems.push("One of the selected cleaners is inactive");
        continue;
      }
      problems.push(...checkCleaner(ctx, c, start, end, { excludeAppointmentId: id, serviceSlug: a.service_slug }).problems);
    }
    if (problems.length && !force) return { ok: false as const, error: "Assignment conflicts", conflicts: problems };
    const before = await tx<{ cleaner_id: string }[]>`select cleaner_id from appointment_assignments where appointment_id = ${id}`;
    try {
      await tx.savepoint(async (sp) => {
        await sp`delete from appointment_assignments where appointment_id = ${id}`;
        for (const cid of cleanerIds) await sp`insert into appointment_assignments (appointment_id, cleaner_id) values (${id}, ${cid})`;
      });
    } catch (e) {
      if (isExclusionViolation(e)) return { ok: false as const, error: "That cleaner already has an overlapping job. Double booking isn't allowed." };
      throw e;
    }
    await recordChange(tx, id, "assign", actor, before.map((b) => b.cleaner_id), cleanerIds);
    await audit(actor, "appointment.assign", "appointment", id, { cleanerIds, forced: problems.length > 0 }, tx);
    return { ok: true as const, message: cleanerIds.length ? "Cleaner assignment saved." : "Cleaners removed from this job." };
  });
}

export type CompletionInput = {
  actual_minutes: number;
  revenue_cents: number;
  supplies_cents: number;
  other_cost_cents: number;
  notes: string;
  checklist_done: string[];
  labor: { cleaner_id: string; minutes: number; clock_in: string | null; clock_out: string | null }[];
};

export async function completeAppointment(id: string, actor: Actor, input: CompletionInput): Promise<ActionResult> {
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const a = await loadCore(tx, id);
    if (!a) return { ok: false as const, error: "Appointment not found" };
    if (!allowed.complete.includes(a.status)) return { ok: false as const, error: `A ${a.status} appointment can't be completed` };
    if (a.starts_at > new Date()) return { ok: false as const, error: "This job hasn't started yet." };
    const wasCompleted = a.status === "completed";
    await tx`update appointments set status = 'completed', actual_minutes = ${input.actual_minutes}, needs_attention = null where id = ${id}`;
    await tx`
      insert into job_records (appointment_id, revenue_cents, supplies_cents, other_cost_cents, checklist_done, notes, recorded_by)
      values (${id}, ${input.revenue_cents}, ${input.supplies_cents}, ${input.other_cost_cents}, ${tx.json(input.checklist_done)}, ${input.notes}, ${actor.id})
      on conflict (appointment_id) do update set revenue_cents = excluded.revenue_cents, supplies_cents = excluded.supplies_cents,
        other_cost_cents = excluded.other_cost_cents, checklist_done = excluded.checklist_done, notes = excluded.notes, recorded_by = excluded.recorded_by`;
    await tx`delete from labor_records where appointment_id = ${id}`;
    const cleaners = await tx<{ id: string; pay_method: PayMethod; pay_rate_cents: number; pay_percent: string }[]>`
      select id, pay_method, pay_rate_cents, pay_percent from cleaners where id = any(${input.labor.map((l) => l.cleaner_id)})`;
    for (const l of input.labor) {
      const c = cleaners.find((x) => x.id === l.cleaner_id);
      if (!c) continue;
      const pay = laborPay(c.pay_method, c.pay_rate_cents, Number(c.pay_percent), l.minutes, input.revenue_cents, input.labor.length);
      await tx`insert into labor_records (appointment_id, cleaner_id, clock_in, clock_out, minutes, pay_cents, pay_basis)
               values (${id}, ${l.cleaner_id}, ${l.clock_in}, ${l.clock_out}, ${l.minutes}, ${pay.pay_cents}, ${pay.basis})`;
    }
    if (!wasCompleted) {
      await tx`update customers set status = 'active', customer_since = coalesce(customer_since, current_date) where id = ${a.customer_id} and status in ('lead','inactive')`;
    }
    await recordChange(tx, id, wasCompleted ? "completion_edit" : "status", actor, { status: a.status }, { status: "completed", revenue_cents: input.revenue_cents });
    await audit(actor, wasCompleted ? "job.update" : "job.complete", "appointment", id, { revenue_cents: input.revenue_cents }, tx);
    return { ok: true as const, a, wasCompleted };
  });
  if (!res.ok) return res;
  let email: SendResult | null = null;
  const settings = await loadSettings();
  if (!res.wasCompleted && settings.notifications.followup_enabled) email = await emailCustomer("followup", res.a);
  return { ok: true, message: res.wasCompleted ? "Job record updated." : "Job marked complete and revenue recorded.", email };
}

export async function updateAppointmentFields(
  id: string,
  actor: Actor,
  f: {
    internal_notes?: string;
    customer_notes?: string;
    access_instructions?: string;
    agreed_price_cents?: number;
    payment_status?: string;
    checklist?: string[];
    service_slug?: string;
  },
): Promise<ActionResult> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [before] = await tx<{ agreed_price_cents: number; series_id: string | null }[]>`select agreed_price_cents, series_id from appointments where id = ${id} for update`;
    if (!before) return { ok: false as const, error: "Appointment not found" };
    await tx`
      update appointments set
        internal_notes = coalesce(${f.internal_notes ?? null}, internal_notes),
        customer_notes = coalesce(${f.customer_notes ?? null}, customer_notes),
        access_instructions = coalesce(${f.access_instructions ?? null}, access_instructions),
        agreed_price_cents = coalesce(${f.agreed_price_cents ?? null}, agreed_price_cents),
        payment_status = coalesce(${f.payment_status ?? null}, payment_status),
        service_slug = coalesce(${f.service_slug ?? null}, service_slug),
        checklist = coalesce(${f.checklist ? tx.json(f.checklist) : null}, checklist),
        is_exception = case when ${f.agreed_price_cents ?? null}::int is not null and series_id is not null then true else is_exception end
      where id = ${id}`;
    if (f.agreed_price_cents !== undefined && f.agreed_price_cents !== before.agreed_price_cents) {
      await recordChange(tx, id, "price", actor, before.agreed_price_cents, f.agreed_price_cents);
    }
    if (f.internal_notes !== undefined || f.customer_notes !== undefined) await recordChange(tx, id, "note", actor, null, null, "Notes updated");
    await audit(actor, "appointment.update", "appointment", id, { fields: Object.keys(f) }, tx);
    return { ok: true as const, message: "Saved." };
  });
}

export async function createManualAppointment(
  actor: Actor,
  input: {
    customer_id: string;
    property_id: string;
    service_slug: string;
    starts_at: string;
    duration_minutes: number;
    price_cents: number;
    cleaner_ids: string[];
    status: "pending" | "confirmed";
    frequency: string;
    internal_notes: string;
    force?: boolean;
    quote_id?: string | null;
  },
): Promise<ActionResult<{ id: string }>> {
  const sql = db();
  const start = DateTime.fromISO(input.starts_at);
  if (!start.isValid) return { ok: false, error: "Invalid date/time" };
  const end = start.plus({ minutes: input.duration_minutes });
  return sql.begin(async (tx) => {
    await lockSchedule(tx);
    const [prop] = await tx<{ id: string; address_line1: string | null; access_instructions: string }[]>`
      select id, address_line1, access_instructions from properties where id = ${input.property_id} and customer_id = ${input.customer_id}`;
    if (!prop) return { ok: false as const, error: "Choose one of this customer's properties" };
    if (!prop.address_line1) return { ok: false as const, error: "Add a street address to this property before booking" };
    const settings = await loadSettings(tx);
    const ctx = await loadScheduleContext(tx, settings, start, end);
    const problems: string[] = [];
    const slot = checkSlot(ctx, start, end, { serviceSlug: input.service_slug });
    problems.push(...slot.problems.filter((p) => input.cleaner_ids.length === 0 || !p.startsWith("No cleaner")));
    for (const cid of input.cleaner_ids) {
      const c = ctx.cleaners.find((x) => x.id === cid);
      if (c) problems.push(...checkCleaner(ctx, c, start, end, { serviceSlug: input.service_slug }).problems);
    }
    if (problems.length && !input.force) return { ok: false as const, error: "This time has conflicts", conflicts: [...new Set(problems)] };
    const [appt] = await tx<{ id: string }[]>`
      insert into appointments (reference, customer_id, property_id, service_slug, quote_id, starts_at, ends_at, status, source, frequency,
                                agreed_price_cents, estimated_minutes, internal_notes, access_instructions, created_by, manage_token_hash)
      values (${newReference("QC")}, ${input.customer_id}, ${input.property_id}, ${input.service_slug}, ${input.quote_id ?? null}, ${start.toJSDate()},
              ${end.toJSDate()}, ${input.status}, 'admin', ${input.frequency}, ${input.price_cents}, ${input.duration_minutes}, ${input.internal_notes},
              ${prop.access_instructions}, ${actor.id}, ${sha256(newToken())})
      returning id`;
    try {
      await tx.savepoint(async (sp) => {
        for (const cid of input.cleaner_ids) await sp`insert into appointment_assignments (appointment_id, cleaner_id) values (${appt.id}, ${cid})`;
      });
    } catch (e) {
      if (isExclusionViolation(e)) throw new Error("A selected cleaner already has an overlapping job. Double booking isn't allowed.");
      throw e;
    }
    if (input.status === "confirmed") {
      await tx`update customers set status = 'active', customer_since = coalesce(customer_since, current_date) where id = ${input.customer_id} and status in ('lead','inactive')`;
      if (input.quote_id) await tx`update quotes set status = 'accepted', accepted_at = coalesce(accepted_at, now()) where id = ${input.quote_id} and status in ('draft','sent','pending_customer')`;
    }
    await recordChange(tx, appt.id, "created", actor, null, { status: input.status, starts_at: start.toISO() }, problems.length ? `Created despite: ${problems.join("; ")}` : "Created by staff");
    await audit(actor, "appointment.create", "appointment", appt.id, {}, tx);
    return { ok: true as const, message: "Appointment created.", data: { id: appt.id } };
  });
}

/** Customer self-service from the manage link. Cancels outright when outside the notice window; otherwise asks staff. */
export async function customerRequest(
  tokenHash: string,
  kind: "cancel" | "reschedule",
  requestedStart: string | null,
  message: string,
): Promise<ActionResult> {
  const sql = db();
  const settings = await loadSettings(sql);
  const res = await sql.begin(async (tx) => {
    const [a] = await tx<(ApptCore & { customer_name: string })[]>`
      select a.id, a.reference, a.status, a.starts_at, a.ends_at, a.estimated_minutes, a.service_slug, a.customer_id, a.series_id, a.quote_id,
             a.agreed_price_cents, c.email as customer_email, c.full_name as customer_name, coalesce(s.name, a.service_slug) as service_name
        from appointments a join customers c on c.id = a.customer_id left join services s on s.slug = a.service_slug
       where a.manage_token_hash = ${tokenHash} for update of a`;
    if (!a) return { ok: false as const, error: "This link is no longer valid." };
    if (!["pending", "confirmed"].includes(a.status)) return { ok: false as const, error: `This appointment is already ${a.status}.` };
    if (a.starts_at < new Date()) return { ok: false as const, error: "This appointment has already started." };
    const [open] = await tx`select 1 from customer_requests where appointment_id = ${a.id} and status = 'open'`;
    if (open) return { ok: false as const, error: "We already have a request from you for this appointment and will reply soon." };
    const hoursUntil = (a.starts_at.getTime() - Date.now()) / 3_600_000;
    const insideNotice = hoursUntil < settings.policies.cancellation_notice_hours;
    const actor = { id: null, label: `Customer (${a.customer_name})` };

    if (kind === "cancel" && !insideNotice) {
      await tx`update appointments set status = 'cancelled', cancelled_reason = ${`Cancelled by customer${message ? `: ${message}` : ""}`} where id = ${a.id}`;
      await tx`insert into customer_requests (appointment_id, kind, message, status, resolved_at) values (${a.id}, 'cancel', ${message}, 'approved', now())`;
      await recordChange(tx, a.id, "customer_request", actor, { status: a.status }, { status: "cancelled" }, message);
      return { ok: true as const, a, cancelled: true, insideNotice };
    }
    await tx`insert into customer_requests (appointment_id, kind, requested_starts_at, message) values (${a.id}, ${kind}, ${requestedStart}, ${message})`;
    const note = kind === "cancel"
      ? `Customer asked to cancel inside the ${settings.policies.cancellation_notice_hours}-hour notice window`
      : `Customer asked to reschedule${requestedStart ? ` to ${formatDateTime(requestedStart, settings.booking.timezone)}` : ""}`;
    await tx`update appointments set needs_attention = ${note} where id = ${a.id}`;
    await recordChange(tx, a.id, "customer_request", actor, null, { kind, requested_starts_at: requestedStart }, message);
    return { ok: true as const, a, cancelled: false, insideNotice };
  });
  if (!res.ok) return res;
  const a = res.a;
  const tz = settings.booking.timezone;
  for (const to of settings.notifications.admin_emails) {
    await sendTemplatedEmail("customer_request", to, {
      customer_name: a.customer_name, kind: kind === "cancel" ? (res.cancelled ? "cancel (done automatically)" : "cancel") : "reschedule",
      reference: a.reference, service: a.service_name, date_time: formatDateTime(a.starts_at, tz), message: message || "(none)",
      admin_url: appUrl(`/admin/appointments/${a.id}`),
    }, { customer_id: a.customer_id, appointment_id: a.id }, { audience: "admin" });
  }
  if (res.cancelled) {
    const email = await sendTemplatedEmail("booking_cancelled", a.customer_email, {
      first_name: a.customer_name.split(/\s+/)[0], reference: a.reference, service: a.service_name, date_time: formatDateTime(a.starts_at, tz),
      message: "You cancelled this appointment online.",
    }, { customer_id: a.customer_id, appointment_id: a.id });
    return { ok: true, message: "Your appointment has been cancelled.", email };
  }
  return {
    ok: true,
    message:
      kind === "cancel"
        ? `Your cancellation request was sent. Because it's within ${settings.policies.cancellation_notice_hours} hours of your appointment, our team will contact you about our cancellation policy.`
        : "Your reschedule request was sent. Your current appointment stays in place until we confirm a new time.",
  };
}

/**
 * Daily automation: reminder emails for confirmed visits starting within the configured window,
 * and (if enabled) thank-you follow-ups for visits completed in the last 3 days. Each visit gets
 * at most one attempt per template; failures stay in the log for a manual retry.
 */
export async function sendDueCustomerEmails() {
  const settings = await loadSettings();
  const n = settings.notifications;
  const out = { reminders: { sent: 0, not_sent: 0 }, followups: { sent: 0, not_sent: 0 } };
  const run = async (template: string, ids: { id: string }[], bucket: { sent: number; not_sent: number }) => {
    for (const { id } of ids) {
      const a = await db().begin((tx) => loadCore(tx, id));
      if (!a) continue;
      const r = await emailCustomer(template, a);
      if (r.status === "sent") bucket.sent++;
      else bucket.not_sent++;
    }
  };
  if (n.reminder_hours_before > 0) {
    const due = await db()<{ id: string }[]>`
      select a.id from appointments a
       where a.status = 'confirmed' and a.starts_at > now() and a.starts_at <= now() + make_interval(hours => ${n.reminder_hours_before})
         and not exists (select 1 from communications m where m.appointment_id = a.id and m.template = 'reminder')
       order by a.starts_at limit 200`;
    await run("reminder", Array.from(due), out.reminders);
  }
  if (n.followup_enabled) {
    const done = await db()<{ id: string }[]>`
      select a.id from appointments a
       where a.status = 'completed' and a.ends_at > now() - interval '3 days' and a.ends_at <= now()
         and not exists (select 1 from communications m where m.appointment_id = a.id and m.template = 'followup')
       order by a.ends_at limit 200`;
    await run("followup", Array.from(done), out.followups);
  }
  return out;
}
