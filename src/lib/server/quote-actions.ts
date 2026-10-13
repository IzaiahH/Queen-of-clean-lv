import "server-only";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { checkSlot } from "@/lib/scheduling/availability";
import { formatCents } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { audit } from "./audit";
import { appUrl, sendTemplatedEmail } from "./email";
import { quoteByToken } from "./public-lookup";
import { quoteAmount } from "./quotes";
import { isExclusionViolation, loadScheduleContext, lockSchedule, recordChange } from "./schedule";
import { loadSettings } from "./settings";
import { newReference, newToken, sha256 } from "./security";

/** Customer accepts a quote from the secure link. Only sent quotes that haven't expired can be accepted. */
export async function acceptQuoteByToken(token: string) {
  const q = await quoteByToken(token);
  if (!q) return { ok: false as const, error: "This quote link is not valid." };
  if (q.status === "accepted") return { ok: true as const, message: "This quote is already accepted." };
  if (!["sent", "pending_customer"].includes(q.status)) return { ok: false as const, error: "This quote can't be accepted right now. Please contact us." };
  if (q.expires_at && q.expires_at < new Date()) {
    await db()`update quotes set status = 'expired' where id = ${q.id}`;
    return { ok: false as const, error: "This quote has expired. Please request a new quote." };
  }
  await db()`update quotes set status = 'accepted', accepted_at = now() where id = ${q.id} and status in ('sent','pending_customer')`;
  await audit({ id: null, label: `Customer (${q.customer_first ?? "unknown"})` }, "quote.accept", "quote", q.id);
  return { ok: true as const, message: "Thank you — your quote is accepted." };
}

/** Requests an appointment for an accepted quote, at its agreed amount. */
export async function bookFromQuoteToken(token: string, slotStart: string) {
  const q = await quoteByToken(token);
  if (!q || !q.customer_id || !q.property_id) return { ok: false as const, error: "This quote link is not valid." };
  if (q.status !== "accepted") return { ok: false as const, error: "Please accept the quote first." };
  if (q.has_appointment) return { ok: false as const, error: "You already have an appointment for this quote." };
  const settings = await loadSettings();
  const start = DateTime.fromISO(slotStart);
  if (!start.isValid) return { ok: false as const, error: "Invalid time" };
  const end = start.plus({ minutes: q.estimated_minutes });
  const manageToken = newToken();
  try {
    const out = await db().begin(async (tx) => {
      await lockSchedule(tx);
      const ctx = await loadScheduleContext(tx, settings, start, end);
      const check = checkSlot(ctx, start, end, { serviceSlug: q.service_slug, enforceLeadTime: true });
      if (!check.ok) return null;
      const [p] = await tx<{ access_instructions: string }[]>`select access_instructions from properties where id = ${q.property_id}`;
      const [a] = await tx<{ id: string; reference: string }[]>`
        insert into appointments (reference, customer_id, property_id, service_slug, quote_id, starts_at, ends_at, status, source, frequency,
                                  agreed_price_cents, estimated_minutes, access_instructions, manage_token_hash)
        values (${newReference("QC")}, ${q.customer_id}, ${q.property_id}, ${q.service_slug}, ${q.id}, ${start.toJSDate()}, ${end.toJSDate()},
                'pending', 'website', ${q.frequency}, ${quoteAmount(q)}, ${q.estimated_minutes}, ${p?.access_instructions ?? ""}, ${sha256(manageToken)})
        returning id, reference`;
      await tx`insert into appointment_assignments (appointment_id, cleaner_id) values (${a.id}, ${check.cleaner_ids[0]})`;
      await recordChange(tx, a.id, "created", { id: null, label: "Customer" }, null, { status: "pending" }, "Requested from accepted quote");
      return a;
    });
    if (!out) return { ok: false as const, error: "That time is no longer available. Please pick another." };
    const [c] = await db()<{ email: string | null; full_name: string }[]>`select email, full_name from customers where id = ${q.customer_id}`;
    await sendTemplatedEmail("request_received", c?.email, {
      first_name: c?.full_name.split(/\s+/)[0], reference: out.reference, service: q.service_name, date_time: formatDateTime(start.toJSDate(), settings.booking.timezone),
      estimate: formatCents(quoteAmount(q)), manage_url: appUrl(`/manage/${manageToken}`), response_time: settings.business.response_time_text,
    }, { customer_id: q.customer_id, appointment_id: out.id, quote_id: q.id });
    for (const to of settings.notifications.admin_new_request_enabled ? settings.notifications.admin_emails : []) {
      await sendTemplatedEmail("admin_new_request", to, { reference: out.reference, service: q.service_name, date_time: formatDateTime(start.toJSDate(), settings.booking.timezone), customer_name: c?.full_name ?? "", estimate: formatCents(quoteAmount(q)), review_reasons: "From accepted quote", admin_url: appUrl(`/admin/appointments/${out.id}`) }, { appointment_id: out.id }, { audience: "admin" });
    }
    return { ok: true as const, manage_url: `/manage/${manageToken}`, reference: out.reference };
  } catch (e) {
    if (isExclusionViolation(e)) return { ok: false as const, error: "That time was just taken. Please pick another." };
    throw e;
  }
}
