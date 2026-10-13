import "server-only";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/time";
import type { PropertyInput } from "@/lib/validation/booking";
import { audit, type Actor } from "./audit";
import { appUrl, sendTemplatedEmail, type SendResult } from "./email";
import { insertQuote, priceFromProperty, quoteAmount } from "./quotes";
import { newToken, sha256 } from "./security";
import { loadSettings } from "./settings";

export type QuoteListRow = {
  id: string; reference: string; status: string; service_name: string; frequency: string; estimate_cents: number; override_cents: number | null;
  requires_review: boolean; customer_id: string | null; customer_name: string | null; created_at: Date; expires_at: Date | null; source: string; has_appointment: boolean;
};

export async function listQuotes(f: { status?: string; q?: string; limit: number; offset: number }) {
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const status = f.status && f.status !== "all" ? f.status : null;
  const rows = await db()<QuoteListRow[]>`
    select q.id, q.reference, q.status, coalesce(s.name, q.service_slug) as service_name, q.frequency, q.estimate_cents, q.override_cents, q.requires_review,
           q.customer_id, c.full_name as customer_name, q.created_at, q.expires_at, q.source,
           exists (select 1 from appointments a where a.quote_id = q.id) as has_appointment
      from quotes q left join customers c on c.id = q.customer_id left join services s on s.slug = q.service_slug
     where (${status}::text is null or q.status = ${status})
       and (${q}::text is null or lower(q.reference) like ${q} or lower(coalesce(c.full_name,'')) like ${q} or lower(coalesce(c.email,'')) like ${q})
     order by (q.status = 'draft') desc, q.created_at desc
     limit ${f.limit} offset ${f.offset}`;
  return Array.from(rows);
}

export async function getQuoteDetail(id: string) {
  const [q] = await db()<{
    id: string; reference: string; status: string; service_slug: string; service_name: string; frequency: string; inputs: Record<string, unknown>;
    pricing_version_id: string; pricing_version: number; estimate_cents: number; recurring_cents: number | null; estimated_minutes: number;
    breakdown: { lines: { kind: string; label: string; quantity: number; amount_cents: number }[]; notes: string[]; mode: string; sqft_used?: number; sqft_assumed?: boolean };
    requires_review: boolean; review_reasons: string[]; override_cents: number | null; override_reason: string | null; override_by_name: string | null; override_at: Date | null;
    source: string; expires_at: Date | null; accepted_at: Date | null; sent_at: Date | null; created_at: Date;
    customer_id: string | null; customer_name: string | null; customer_email: string | null; customer_phone: string | null;
    property_id: string | null; address: string | null; has_address: boolean;
  }[]>`
    select q.id, q.reference, q.status, q.service_slug, coalesce(s.name, q.service_slug) as service_name, q.frequency, q.inputs, q.pricing_version_id,
           pv.version as pricing_version, q.estimate_cents, q.recurring_cents, q.estimated_minutes, q.breakdown, q.requires_review, q.review_reasons,
           q.override_cents, q.override_reason, op.full_name as override_by_name, q.override_at, q.source, q.expires_at, q.accepted_at, q.sent_at, q.created_at,
           q.customer_id, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone,
           q.property_id, concat_ws(', ', p.address_line1, p.unit, p.city, p.zip) as address, p.address_line1 is not null as has_address
      from quotes q
      join pricing_versions pv on pv.id = q.pricing_version_id
      left join services s on s.slug = q.service_slug
      left join customers c on c.id = q.customer_id
      left join properties p on p.id = q.property_id
      left join profiles op on op.id = q.override_by
     where q.id = ${id}`;
  if (!q) return null;
  const [appointments, comms] = await Promise.all([
    db()<{ id: string; reference: string; status: string; starts_at: Date }[]>`select id, reference, status, starts_at from appointments where quote_id = ${id} order by starts_at`,
    db()<{ id: string; subject: string; status: string; error: string | null; created_at: Date }[]>`select id, subject, status, error, created_at from communications where quote_id = ${id} order by created_at desc`,
  ]);
  return { q: { ...q }, appointments: Array.from(appointments).map((x) => ({ ...x })), comms: Array.from(comms).map((x) => ({ ...x })) };
}

/** Staff-built quote for an existing customer/property, priced with the published rules. */
export async function createAdminQuote(actor: Actor, input: { customer_id: string; property_id: string; property: PropertyInput; notes: string }) {
  const priced = await priceFromProperty(input.property);
  if ("error" in priced) return { ok: false as const, error: priced.error };
  const settings = await loadSettings();
  return db().begin(async (tx) => {
    const [own] = await tx`select 1 from properties where id = ${input.property_id} and customer_id = ${input.customer_id}`;
    if (!own) return { ok: false as const, error: "Choose one of this customer's properties" };
    const created = await insertQuote(tx, {
      priced, customerId: input.customer_id, propertyId: input.property_id, status: "draft", source: "admin",
      extraInputs: { staff_notes: input.notes }, createdBy: actor.id, expirationDays: settings.booking.quote_expiration_days,
    });
    await audit(actor, "quote.create", "quote", created.id, { estimate_cents: priced.result.total_cents }, tx);
    return { ok: true as const, id: created.id };
  });
}

export async function overrideQuote(actor: Actor, id: string, cents: number | null, reason: string) {
  if (cents !== null && !reason.trim()) return { ok: false as const, error: "Give a reason for the price change (kept in the record)." };
  const r = await db()`
    update quotes set override_cents = ${cents}, override_reason = ${cents === null ? null : reason.trim()}, override_by = ${cents === null ? null : actor.id},
           override_at = ${cents === null ? null : new Date()}
     where id = ${id} and status in ('draft','sent','pending_customer')`;
  if (!r.count) return { ok: false as const, error: "Only open quotes can be adjusted." };
  await audit(actor, cents === null ? "quote.override_clear" : "quote.override", "quote", id, { cents, reason });
  return { ok: true as const };
}

export async function setQuoteStatus(actor: Actor, id: string, status: "draft" | "declined" | "expired" | "accepted") {
  const from: Record<string, string[]> = {
    draft: ["sent", "pending_customer", "declined", "expired"],
    declined: ["draft", "sent", "pending_customer"],
    expired: ["draft", "sent", "pending_customer"],
    accepted: ["draft", "sent", "pending_customer"],
  };
  const r = await db()`
    update quotes set status = ${status}, accepted_at = case when ${status} = 'accepted' then now() else accepted_at end
     where id = ${id} and status = any(${from[status]})`;
  if (!r.count) return { ok: false as const, error: "That status change isn't allowed from the quote's current status." };
  await audit(actor, `quote.${status}`, "quote", id);
  return { ok: true as const };
}

/** Issues a fresh secure link (only its hash is stored), extends expiry, and emails it. Status only changes if the email really went out. */
export async function sendQuote(actor: Actor, id: string): Promise<{ ok: true; email: SendResult } | { ok: false; error: string }> {
  const settings = await loadSettings();
  const [q] = await db()<{ status: string; reference: string; service_name: string; estimate_cents: number; override_cents: number | null; email: string | null; full_name: string | null }[]>`
    select q.status, q.reference, coalesce(s.name, q.service_slug) as service_name, q.estimate_cents, q.override_cents, c.email, c.full_name
      from quotes q left join customers c on c.id = q.customer_id left join services s on s.slug = q.service_slug where q.id = ${id}`;
  if (!q) return { ok: false, error: "Quote not found" };
  if (!["draft", "sent", "pending_customer", "expired"].includes(q.status)) return { ok: false, error: `A ${q.status} quote can't be sent.` };
  if (!q.email) return { ok: false, error: "This customer has no email address." };
  const token = newToken();
  const expires = DateTime.now().plus({ days: settings.booking.quote_expiration_days });
  const email = await sendTemplatedEmail("quote", q.email, {
    first_name: q.full_name?.split(/\s+/)[0] ?? "there", reference: q.reference, service: q.service_name, estimate: formatCents(quoteAmount(q)),
    quote_url: appUrl(`/quote/${token}`), expires: formatDate(expires.toJSDate(), settings.booking.timezone),
  }, { quote_id: id });
  if (email.status === "sent") {
    await db()`update quotes set public_token_hash = ${sha256(token)}, status = 'pending_customer', sent_at = now(), expires_at = ${expires.toJSDate()} where id = ${id}`;
  }
  await audit(actor, "quote.send", "quote", id, { email: email.status });
  return { ok: true, email };
}

/** Daily: open quotes past their expiry become expired. */
export async function expireQuotes() {
  const r = await db()`update quotes set status = 'expired' where status in ('sent','pending_customer') and expires_at < now()`;
  return r.count;
}
