"use server";

import { DateTime } from "luxon";
import { z } from "zod";
import { loadSettings } from "@/lib/server/settings";
import { db } from "@/lib/db";
import {
  assignCleaners, cancelAppointment, completeAppointment, confirmAppointment, createManualAppointment, declineAppointment,
  rescheduleAppointment, sendConfirmation, setStatusSimple, updateAppointmentFields,
} from "@/lib/server/appointments";
import { audit } from "@/lib/server/audit";
import { retryCommunication } from "@/lib/server/email";
import { createSeries, seriesImpact, setSeriesStatus, updateSeries } from "@/lib/server/series";
import { guard, plainEmail, type Res } from "./guard";

const uuid = z.string().uuid();
const out = (r: { ok: boolean; message?: string; error?: string; conflicts?: string[]; email?: { status: string; error?: string } | null; data?: unknown }): Res => ({
  ok: r.ok, message: r.message, error: r.error, conflicts: r.conflicts, email: plainEmail(r.email), data: r.data,
});

export async function confirmAction(id: string, notify: boolean) {
  return guard("schedule.edit", async (_u, actor) => out(await confirmAppointment(uuid.parse(id), actor, notify)));
}
export async function sendConfirmationAction(id: string) {
  return guard("schedule.edit", async (_u, actor) => out(await sendConfirmation(uuid.parse(id), actor)));
}
export async function declineAction(id: string, message: string, notify: boolean) {
  return guard("schedule.edit", async (_u, actor) => out(await declineAppointment(uuid.parse(id), actor, z.string().max(1000).parse(message), notify)));
}
export async function cancelAction(id: string, reason: string, notify: boolean, skip = false) {
  return guard("schedule.edit", async (_u, actor) => out(await cancelAppointment(uuid.parse(id), actor, z.string().max(1000).parse(reason), notify, skip)));
}
export async function noShowAction(id: string) {
  return guard("schedule.edit", async (_u, actor) => out(await setStatusSimple(uuid.parse(id), actor, "no_show")));
}
export async function reopenAction(id: string) {
  return guard("schedule.edit", async (_u, actor) => out(await setStatusSimple(uuid.parse(id), actor, "pending")));
}
export async function rescheduleAction(id: string, startsAt: string, durationMinutes: number | null, force: boolean, notify: boolean) {
  return guard("schedule.edit", async (_u, actor) =>
    out(await rescheduleAppointment(uuid.parse(id), actor, { starts_at: z.string().datetime({ offset: true }).parse(startsAt), duration_minutes: durationMinutes ? z.number().int().min(15).max(960).parse(durationMinutes) : undefined, force, notify })));
}
export async function assignAction(id: string, cleanerIds: string[], force: boolean) {
  return guard("schedule.edit", async (_u, actor) => out(await assignCleaners(uuid.parse(id), actor, z.array(uuid).max(6).parse(cleanerIds), force)));
}

const completion = z.object({
  actual_minutes: z.number().int().min(0).max(2880),
  revenue_cents: z.number().int().min(0).max(1_000_000),
  supplies_cents: z.number().int().min(0).max(100_000),
  other_cost_cents: z.number().int().min(0).max(100_000),
  notes: z.string().max(2000),
  checklist_done: z.array(z.string().max(200)).max(100),
  labor: z.array(z.object({ cleaner_id: uuid, minutes: z.number().int().min(0).max(2880), clock_in: z.string().datetime({ offset: true }).nullable(), clock_out: z.string().datetime({ offset: true }).nullable() })).max(6),
});
export async function completeAction(id: string, input: z.infer<typeof completion>) {
  return guard("schedule.edit", async (user, actor) => {
    // Recording money on a job is a finance action; office staff can complete the job but labor pay is computed server-side either way.
    const data = completion.parse(input);
    if (user.role === "office" && data.revenue_cents === 0) return { ok: false, error: "Enter the amount charged." };
    return out(await completeAppointment(uuid.parse(id), actor, data));
  });
}

const fields = z.object({
  internal_notes: z.string().max(5000).optional(),
  customer_notes: z.string().max(2000).optional(),
  access_instructions: z.string().max(2000).optional(),
  agreed_price_cents: z.number().int().min(0).max(1_000_000).optional(),
  payment_status: z.enum(["unpaid", "partial", "paid", "not_tracked"]).optional(),
  checklist: z.array(z.string().max(200)).max(100).optional(),
});
export async function updateFieldsAction(id: string, input: z.infer<typeof fields>) {
  return guard("schedule.edit", async (_u, actor) => out(await updateAppointmentFields(uuid.parse(id), actor, fields.parse(input))));
}

const manual = z.object({
  customer_id: uuid, property_id: uuid, service_slug: z.string().min(1).max(40), starts_at: z.string().datetime({ offset: true }),
  duration_minutes: z.number().int().min(15).max(960), price_cents: z.number().int().min(0).max(1_000_000), cleaner_ids: z.array(uuid).max(6),
  status: z.enum(["pending", "confirmed"]), frequency: z.string().max(20), internal_notes: z.string().max(5000),
  recurring: z.object({ frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "custom"]), interval_days: z.number().int().min(1).max(365).nullable() }).nullable(),
  quote_id: uuid.nullable().optional(),
});
export async function createAppointmentAction(input: z.infer<typeof manual>, force: boolean) {
  return guard("schedule.edit", async (_u, actor) => {
    const d = manual.parse(input);
    if (d.recurring) {
      const tz = (await loadSettings()).booking.timezone;
      const local = DateTime.fromISO(d.starts_at).setZone(tz);
      return out(await createSeries(actor, {
        customer_id: d.customer_id, property_id: d.property_id, service_slug: d.service_slug, frequency: d.recurring.frequency, interval_days: d.recurring.interval_days,
        anchor_date: local.toISODate()!, start_time: local.toFormat("HH:mm"), duration_minutes: d.duration_minutes,
        price_cents: d.price_cents, cleaner_ids: d.cleaner_ids, notes: d.internal_notes, quote_id: d.quote_id ?? null,
      }));
    }
    return out(await createManualAppointment(actor, { ...d, force }));
  });
}

/** Turns a confirmed one-off (e.g. a website request) into the first visit of a recurring schedule. */
export async function startSeriesFromAppointmentAction(appointmentId: string, input: { frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "custom"; interval_days: number | null; price_cents: number }) {
  return guard("schedule.edit", async (_u, actor) => {
    const [a] = await db()<{ customer_id: string; property_id: string; service_slug: string; quote_id: string | null; starts_at: Date; estimated_minutes: number; series_id: string | null; status: string; cleaner_ids: string[] }[]>`
      select a.customer_id, a.property_id, a.service_slug, a.quote_id, a.starts_at, a.estimated_minutes, a.series_id, a.status,
             coalesce(array_agg(aa.cleaner_id) filter (where aa.cleaner_id is not null), '{}') as cleaner_ids
        from appointments a left join appointment_assignments aa on aa.appointment_id = a.id where a.id = ${uuid.parse(appointmentId)} group by a.id`;
    if (!a) return { ok: false, error: "Appointment not found" };
    if (a.series_id) return { ok: false, error: "This visit is already part of a recurring schedule" };
    if (a.status !== "confirmed") return { ok: false, error: "Confirm the first visit before starting a recurring schedule" };
    const tz = (await loadSettings()).booking.timezone;
    const local = DateTime.fromJSDate(a.starts_at).setZone(tz);
    return out(await createSeries(actor, {
      customer_id: a.customer_id, property_id: a.property_id, service_slug: a.service_slug, quote_id: a.quote_id, frequency: input.frequency, interval_days: input.interval_days,
      anchor_date: local.toISODate()!, start_time: local.toFormat("HH:mm"), duration_minutes: a.estimated_minutes,
      price_cents: z.number().int().min(0).max(1_000_000).parse(input.price_cents), cleaner_ids: a.cleaner_ids,
    }, appointmentId));
  });
}

export async function seriesImpactAction(seriesId: string, fromDate: string | null) {
  return guard("schedule.view", async () => ({ ok: true, data: await seriesImpact(uuid.parse(seriesId), fromDate) }));
}

const seriesChanges = z.object({
  frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "custom"]).optional(),
  interval_days: z.number().int().min(1).max(365).nullable().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  duration_minutes: z.number().int().min(15).max(960).optional(),
  price_cents: z.number().int().min(0).max(1_000_000).optional(),
  cleaner_ids: z.array(uuid).max(6).optional(),
  anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export async function updateSeriesAction(seriesId: string, scope: "future" | "all", fromDate: string | null, changes: z.infer<typeof seriesChanges>) {
  return guard("schedule.edit", async (_u, actor) => out(await updateSeries(actor, uuid.parse(seriesId), scope === "future" ? fromDate : null, seriesChanges.parse(changes))));
}
export async function seriesStatusAction(seriesId: string, status: "active" | "paused" | "cancelled") {
  return guard("schedule.edit", async (_u, actor) => out(await setSeriesStatus(actor, uuid.parse(seriesId), z.enum(["active", "paused", "cancelled"]).parse(status))));
}

export async function retryEmailAction(id: string) {
  return guard("schedule.edit", async (_u, actor) => {
    const r = await retryCommunication(uuid.parse(id));
    await audit(actor, "communication.retry", "communication", id, { status: r.status });
    return { ok: r.status === "sent", message: r.status === "sent" ? "Email sent." : undefined, error: r.status !== "sent" ? `Not sent: ${r.error}` : undefined };
  });
}

export async function resolveRequestAction(requestId: string, decision: "denied") {
  return guard("schedule.edit", async (user, actor) => {
    await db()`update customer_requests set status = ${decision}, resolved_by = ${user.id}, resolved_at = now() where id = ${uuid.parse(requestId)} and status = 'open'`;
    await db()`update appointments set needs_attention = null where id = (select appointment_id from customer_requests where id = ${requestId}) and needs_attention like 'Customer asked%'`;
    await audit(actor, "customer_request.deny", "customer_request", requestId);
    return { ok: true, message: "Request closed. Contact the customer to let them know." };
  });
}
