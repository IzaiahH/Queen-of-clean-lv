"use server";

import { z } from "zod";
import { priceFromProperty } from "@/lib/server/quotes";
import { createAdminQuote, overrideQuote, sendQuote, setQuoteStatus } from "@/lib/server/quotes-admin";
import { propertyInputSchema, type PropertyInput } from "@/lib/validation/booking";
import { guard, plainEmail } from "./guard";

const uuid = z.string().uuid();

export async function previewQuoteAction(property: PropertyInput) {
  return guard("quotes.edit", async () => {
    const priced = await priceFromProperty(propertyInputSchema.parse(property));
    if ("error" in priced) return { ok: false, error: priced.error };
    const r = priced.result;
    return { ok: true, data: { lines: r.lines.map((l) => ({ label: l.label, amount_cents: l.amount_cents })), total_cents: r.total_cents, recurring_per_visit_cents: r.recurring_per_visit_cents, estimated_minutes: r.estimated_minutes, requires_review: r.requires_review, review_reasons: r.review_reasons, notes: r.notes, mode: r.mode, version: priced.version, area: priced.area?.name ?? null, area_message: priced.areaMessage } };
  });
}

export async function createQuoteAction(input: { customer_id: string; property_id: string; property: PropertyInput; notes: string }) {
  return guard("quotes.edit", async (_u, actor) => {
    const r = await createAdminQuote(actor, { customer_id: uuid.parse(input.customer_id), property_id: uuid.parse(input.property_id), property: propertyInputSchema.parse(input.property), notes: z.string().max(2000).parse(input.notes) });
    return r.ok ? { ok: true, message: "Quote saved as a draft.", data: { id: r.id } } : r;
  });
}

export async function overrideQuoteAction(id: string, cents: number | null, reason: string) {
  return guard("quotes.override", async (_u, actor) => {
    const r = await overrideQuote(actor, uuid.parse(id), cents === null ? null : z.number().int().min(0).max(1_000_000).parse(cents), z.string().max(500).parse(reason));
    return r.ok ? { ok: true, message: cents === null ? "Back to the calculated price." : "Price adjusted. The reason is saved with the quote." } : r;
  });
}

export async function quoteStatusAction(id: string, status: "draft" | "declined" | "expired" | "accepted") {
  return guard("quotes.edit", async (_u, actor) => {
    const r = await setQuoteStatus(actor, uuid.parse(id), z.enum(["draft", "declined", "expired", "accepted"]).parse(status));
    return r.ok ? { ok: true, message: "Quote updated." } : r;
  });
}

export async function sendQuoteAction(id: string) {
  return guard("quotes.edit", async (_u, actor) => {
    const r = await sendQuote(actor, uuid.parse(id));
    if (!r.ok) return r;
    if (r.email.status !== "sent") return { ok: false, error: `Quote not sent: ${r.email.error ?? r.email.status}. Its status was left unchanged.` };
    return { ok: true, message: "Quote emailed with a secure link.", email: plainEmail(r.email) };
  });
}

export async function propertyForQuoteAction(propertyId: string) {
  return guard("quotes.edit", async () => {
    const { db } = await import("@/lib/db");
    const [p] = await db()<{ property_type: string; bedrooms: number | null; full_baths: number | null; half_baths: number; sqft: number | null; zip: string | null; condition: string | null }[]>`
      select property_type, bedrooms, full_baths, half_baths, sqft, zip, condition from properties where id = ${uuid.parse(propertyId)}`;
    return p ? { ok: true, data: { ...p } } : { ok: false, error: "Property not found" };
  });
}
