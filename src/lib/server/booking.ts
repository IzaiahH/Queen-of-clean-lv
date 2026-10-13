import "server-only";
import { DateTime } from "luxon";
import { db, type Tx } from "@/lib/db";
import { checkSlot } from "@/lib/scheduling/availability";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABELS } from "@/lib/pricing/rules";
import type { BookingRequest } from "@/lib/validation/booking";
import { CUSTOMER_ACTOR, audit } from "./audit";
import { appUrl, sendTemplatedEmail, type SendResult } from "./email";
import { insertQuote, priceFromProperty } from "./quotes";
import { isExclusionViolation, loadScheduleContext, lockSchedule, recordChange } from "./schedule";
import { loadSettings } from "./settings";
import { newReference, newToken, sha256 } from "./security";
import { formatDateTime } from "@/lib/time";

export type BookingOutcome =
  | {
      ok: true;
      kind: "appointment" | "quote";
      reference: string;
      status: string;
      manage_url: string | null;
      quote_url: string | null;
      duplicate: boolean;
      email: SendResult["status"] | null;
    }
  | { ok: false; error: string; field?: string; slot_taken?: boolean };

/** Finds the customer by email, or creates one. Never updates an existing record from public input. */
async function matchOrCreateCustomer(tx: Tx, c: BookingRequest["contact"], status: "lead" | "active") {
  const [existing] = await tx<{ id: string; has_completed: boolean }[]>`
    select c.id, exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'completed') as has_completed
      from customers c
     where lower(c.email) = ${c.email} and c.merged_into_id is null and c.status <> 'archived'
     order by c.created_at limit 1`;
  if (existing) {
    await tx`update customers set booking_comms_consent = true where id = ${existing.id}`;
    return { id: existing.id, returning: existing.has_completed, created: false };
  }
  const [row] = await tx<{ id: string }[]>`
    insert into customers (full_name, email, phone, preferred_contact, status, source, booking_comms_consent)
    values (${c.full_name}, ${c.email}, ${c.phone}, ${c.preferred_contact}, ${status}, 'website', true)
    returning id`;
  return { id: row.id, returning: false, created: true };
}

async function matchOrCreateProperty(tx: Tx, customerId: string, p: BookingRequest["property"], areaId: string | null, accessInstructions: string) {
  const [existing] = await tx<{ id: string }[]>`
    select id from properties
     where customer_id = ${customerId}
       and lower(trim(address_line1)) = ${p.address_line1.toLowerCase()}
       and coalesce(lower(unit), '') = ${(p.unit ?? "").toLowerCase()}
       and zip = ${p.zip}
     limit 1`;
  if (existing) return existing.id;
  const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from properties where customer_id = ${customerId}`;
  const [row] = await tx<{ id: string }[]>`
    insert into properties (customer_id, address_line1, unit, city, zip, service_area_id, property_type, bedrooms, full_baths, half_baths,
                            sqft, pets, condition, access_instructions, special_requirements, is_primary)
    values (${customerId}, ${p.address_line1}, ${p.unit || null}, ${p.city}, ${p.zip}, ${areaId}, ${p.property_type}, ${p.bedrooms},
            ${p.full_baths}, ${p.half_baths}, ${p.sqft}, ${p.pets > 0 ? `${p.pets} pet(s)${p.pet_details ? `: ${p.pet_details}` : ""}` : ""},
            ${p.condition}, ${accessInstructions}, ${p.special_requests}, ${count === 0})
    returning id`;
  return row.id;
}

/**
 * Public booking/quote submission. Re-prices on the server, re-checks the slot under a lock,
 * and relies on the assignment exclusion constraint as a final guard against double booking.
 */
export async function submitBookingRequest(req: BookingRequest): Promise<BookingOutcome> {
  const sql = db();

  // Duplicate submit (double tap, retry after a timeout): return the original result.
  const [dupAppt] = await sql<{ reference: string; status: string }[]>`select reference, status from appointments where idempotency_key = ${req.idempotency_key}`;
  if (dupAppt) return { ok: true, kind: "appointment", reference: dupAppt.reference, status: dupAppt.status, manage_url: null, quote_url: null, duplicate: true, email: null };
  const [dupQuote] = await sql<{ reference: string; status: string }[]>`select reference, status from quotes where idempotency_key = ${req.idempotency_key}`;
  if (dupQuote && req.mode === "quote_only")
    return { ok: true, kind: "quote", reference: dupQuote.reference, status: dupQuote.status, manage_url: null, quote_url: null, duplicate: true, email: null };

  const settings = await loadSettings(sql);
  const tz = settings.booking.timezone;
  const priced = await priceFromProperty(req.property, sql);
  if ("error" in priced) return { ok: false, error: priced.error };
  const { result } = priced;
  const extraInputs = {
    property_type: req.property.property_type,
    recently_cleaned: req.property.recently_cleaned,
    pet_details: req.property.pet_details,
    occupancy: req.property.occupancy,
    special_requests: req.property.special_requests,
    zip: req.property.zip,
    preferred_window: req.schedule.preferred_window,
  };

  try {
    const out = await sql.begin(async (tx) => {
      await lockSchedule(tx);

      if (req.mode === "quote_only") {
        const customer = await matchOrCreateCustomer(tx, req.contact, "lead");
        const propertyId = await matchOrCreateProperty(tx, customer.id, req.property, priced.area?.id ?? null, req.contact.access_instructions);
        const quote = await insertQuote(tx, {
          priced,
          customerId: customer.id,
          propertyId,
          status: result.requires_review ? "draft" : "sent",
          source: "website",
          extraInputs,
          idempotencyKey: req.idempotency_key,
          expirationDays: settings.booking.quote_expiration_days,
        });
        if (!result.requires_review) await tx`update quotes set sent_at = now() where id = ${quote.id}`;
        await audit(CUSTOMER_ACTOR(req.contact.full_name), "quote.requested", "quote", quote.id, {}, tx);
        return { kind: "quote" as const, quote, customer, appointment: null };
      }

      const start = DateTime.fromISO(req.schedule.slot_start!);
      const end = start.plus({ minutes: result.estimated_minutes });
      const ctx = await loadScheduleContext(tx, settings, start, end);
      const check = checkSlot(ctx, start, end, { serviceSlug: req.property.service, enforceLeadTime: true });
      if (!check.ok) return { kind: "slot_taken" as const, problems: check.problems };

      const customer = await matchOrCreateCustomer(tx, req.contact, "lead");
      const propertyId = await matchOrCreateProperty(tx, customer.id, req.property, priced.area?.id ?? null, req.contact.access_instructions);
      const quote = await insertQuote(tx, {
        priced,
        customerId: customer.id,
        propertyId,
        status: result.requires_review ? "draft" : "accepted",
        source: "website",
        extraInputs,
        expirationDays: settings.booking.quote_expiration_days,
      });

      const ac = settings.booking.auto_confirm;
      const autoConfirm =
        ac.enabled && !result.requires_review && result.total_cents <= ac.max_estimate_cents && (!ac.returning_customers_only || customer.returning);
      const manageToken = newToken();
      const reference = newReference("QC");
      const addonsSnapshot = result.lines.filter((l) => l.kind === "addon").map((l) => ({ label: l.label, quantity: l.quantity, amount_cents: l.amount_cents }));
      const prefs = [
        req.schedule.preferences,
        req.schedule.wants_recurring ? `Customer would like a recurring ${FREQUENCY_LABELS[req.property.frequency].toLowerCase()} schedule.` : "",
      ].filter(Boolean).join("\n");
      const [appt] = await tx<{ id: string }[]>`
        insert into appointments (reference, customer_id, property_id, service_slug, quote_id, starts_at, ends_at, status, source, frequency,
                                  agreed_price_cents, estimated_minutes, addons, customer_notes, access_instructions, scheduling_preferences,
                                  manage_token_hash, idempotency_key, payment_status, needs_attention)
        values (${reference}, ${customer.id}, ${propertyId}, ${req.property.service}, ${quote.id}, ${start.toJSDate()}, ${end.toJSDate()},
                ${autoConfirm ? "confirmed" : "pending"}, 'website', ${req.property.frequency}, ${result.total_cents}, ${result.estimated_minutes},
                ${tx.json(addonsSnapshot as never)}, ${req.contact.notes}, ${req.contact.access_instructions}, ${prefs},
                ${sha256(manageToken)}, ${req.idempotency_key}, 'unpaid', ${result.requires_review ? result.review_reasons.join(" ") : null})
        returning id`;
      await tx`insert into appointment_assignments (appointment_id, cleaner_id) values (${appt.id}, ${check.cleaner_ids[0]})`;
      if (autoConfirm) await tx`update customers set status = 'active', customer_since = coalesce(customer_since, current_date) where id = ${customer.id}`;
      await recordChange(tx, appt.id, "created", CUSTOMER_ACTOR(req.contact.full_name), null, { status: autoConfirm ? "confirmed" : "pending", starts_at: start.toISO() },
        autoConfirm ? "Requested online and confirmed automatically" : "Requested online");
      await audit(CUSTOMER_ACTOR(req.contact.full_name), "booking.requested", "appointment", appt.id, { reference, auto_confirmed: autoConfirm }, tx);
      return { kind: "appointment" as const, quote, customer, appointment: { id: appt.id, reference, manageToken, status: autoConfirm ? "confirmed" : "pending", start } };
    });

    if (out.kind === "slot_taken") {
      return { ok: false, slot_taken: true, field: "schedule.slot_start", error: "Sorry — that time was just taken or is no longer available. Please choose another time." };
    }

    const firstName = req.contact.full_name.split(/\s+/)[0];
    const estimate = result.mode === "custom" ? "Custom quote — we'll follow up" : formatCents(result.total_cents);
    if (out.kind === "quote") {
      const quoteUrl = appUrl(`/quote/${out.quote.token}`);
      let email: SendResult | null = null;
      if (!result.requires_review) {
        email = await sendTemplatedEmail("quote", req.contact.email, {
          first_name: firstName, reference: out.quote.reference, service: priced.serviceName, estimate, quote_url: quoteUrl,
          expires: DateTime.now().setZone(tz).plus({ days: settings.booking.quote_expiration_days }).toFormat("LLL d, yyyy"),
        }, { customer_id: out.customer.id, quote_id: out.quote.id });
      }
      await notifyAdmins(settings.notifications.admin_new_request_enabled ? settings.notifications.admin_emails : [], {
        reference: out.quote.reference, service: priced.serviceName, date_time: "No time requested (quote only)", customer_name: req.contact.full_name,
        estimate, review_reasons: result.review_reasons.join("; ") || "None", admin_url: appUrl(`/admin/quotes/${out.quote.id}`),
      }, { customer_id: out.customer.id, quote_id: out.quote.id });
      return { ok: true, kind: "quote", reference: out.quote.reference, status: result.requires_review ? "draft" : "sent", manage_url: null, quote_url: result.requires_review ? null : quoteUrl, duplicate: false, email: email?.status ?? null };
    }

    const a = out.appointment;
    const manageUrl = appUrl(`/manage/${a.manageToken}`);
    const dateTime = formatDateTime(a.start.toJSDate(), tz);
    const email = await sendTemplatedEmail(a.status === "confirmed" ? "booking_confirmed" : "request_received", req.contact.email, {
      first_name: firstName, reference: a.reference, service: priced.serviceName, date_time: dateTime, estimate, price: estimate,
      manage_url: manageUrl, response_time: settings.business.response_time_text, cancellation_policy: settings.policies.cancellation_policy,
    }, { customer_id: out.customer.id, appointment_id: a.id, quote_id: out.quote.id });
    await notifyAdmins(settings.notifications.admin_new_request_enabled ? settings.notifications.admin_emails : [], {
      reference: a.reference, service: priced.serviceName, date_time: dateTime, customer_name: req.contact.full_name, estimate,
      review_reasons: result.review_reasons.join("; ") || "None", admin_url: appUrl(`/admin/appointments/${a.id}`),
    }, { customer_id: out.customer.id, appointment_id: a.id });
    return { ok: true, kind: "appointment", reference: a.reference, status: a.status, manage_url: `/manage/${a.manageToken}`, quote_url: null, duplicate: false, email: email.status };
  } catch (e) {
    if (isExclusionViolation(e)) {
      return { ok: false, slot_taken: true, field: "schedule.slot_start", error: "Sorry — that time was just taken. Please choose another time." };
    }
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "23505" && String((e as { constraint_name?: string }).constraint_name ?? "").includes("idempotency")) {
      const [again] = await sql<{ reference: string; status: string }[]>`select reference, status from appointments where idempotency_key = ${req.idempotency_key}`;
      if (again) return { ok: true, kind: "appointment", reference: again.reference, status: again.status, manage_url: null, quote_url: null, duplicate: true, email: null };
    }
    throw e;
  }
}

export async function notifyAdmins(emails: string[], vars: Record<string, string>, links: { customer_id?: string; appointment_id?: string; quote_id?: string }, template = "admin_new_request") {
  for (const to of emails) {
    await sendTemplatedEmail(template, to, vars, links, { audience: "admin" });
  }
}
