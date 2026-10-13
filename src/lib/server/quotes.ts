import "server-only";
import { DateTime } from "luxon";
import { db, type Tx } from "@/lib/db";
import { calculateQuote, type QuoteInput, type QuoteResult } from "@/lib/pricing/engine";
import type { PropertyInput } from "@/lib/validation/booking";
import { catalogNames, getPublishedPricing, listAddons, listAreas, listServices, matchArea, type AreaRow } from "./catalog";
import { loadSettings } from "./settings";
import { newReference, newToken, sha256 } from "./security";

export type PricedQuote = {
  versionId: string;
  version: number;
  result: QuoteResult;
  input: QuoteInput;
  area: AreaRow | null;
  areaMessage: string | null;
  serviceName: string;
};

/** Prices customer-submitted details against the published rules and enabled catalog. */
export async function priceFromProperty(p: PropertyInput, tx: Tx = db()): Promise<PricedQuote | { error: string }> {
  const [pricing, services, addons, areas, settings] = await Promise.all([
    getPublishedPricing(tx),
    listServices(tx, true),
    listAddons(tx, true),
    listAreas(tx, true),
    loadSettings(tx),
  ]);
  const service = services.find((s) => s.slug === p.service);
  if (!service) return { error: "That service isn't currently offered." };
  if (!service.allowed_frequencies.includes(p.frequency)) return { error: "That frequency isn't offered for this service." };
  for (const a of p.addons) if (!addons.some((x) => x.slug === a.slug)) return { error: "One of the selected extras is no longer offered." };

  const area = matchArea(areas, p.zip, settings.booking.allow_unknown_areas);
  if ("rejected" in area) return { error: area.message };

  const input: QuoteInput = {
    service: p.service,
    frequency: p.frequency,
    bedrooms: p.bedrooms,
    full_baths: p.full_baths,
    half_baths: p.half_baths,
    sqft: p.sqft,
    condition: p.condition,
    pets: p.pets,
    addons: p.addons,
    travel_fee_cents: area.travel_fee_cents,
    area_requires_review: area.requires_review,
  };
  const result = calculateQuote(pricing.rules, input, catalogNames(services, addons));
  if (!result.ok) return { error: result.error };
  if (service.requires_review && !result.requires_review) {
    result.requires_review = true;
    result.review_reasons.push(`${service.name} requests are confirmed after a quick review.`);
  }
  return { versionId: pricing.id, version: pricing.version, result, input, area: area.area, areaMessage: area.message, serviceName: service.name };
}

export async function insertQuote(
  tx: Tx,
  q: {
    priced: PricedQuote;
    customerId: string | null;
    propertyId: string | null;
    status: "draft" | "sent" | "pending_customer" | "accepted";
    source: "website" | "admin";
    extraInputs?: Record<string, unknown>;
    idempotencyKey?: string | null;
    createdBy?: string | null;
    expirationDays: number;
  },
): Promise<{ id: string; reference: string; token: string }> {
  const token = newToken();
  const { result, input } = q.priced;
  const expires = DateTime.now().plus({ days: q.expirationDays }).toJSDate();
  const [row] = await tx<{ id: string; reference: string }[]>`
    insert into quotes (reference, customer_id, property_id, service_slug, frequency, inputs, pricing_version_id,
                        estimate_cents, recurring_cents, estimated_minutes, breakdown, requires_review, review_reasons,
                        status, source, public_token_hash, idempotency_key, expires_at, accepted_at, created_by)
    values (${newReference("Q")}, ${q.customerId}, ${q.propertyId}, ${input.service}, ${input.frequency},
            ${tx.json({ ...input, ...(q.extraInputs ?? {}), area: q.priced.area?.name ?? null } as never)}, ${q.priced.versionId},
            ${result.total_cents}, ${result.recurring_per_visit_cents}, ${result.estimated_minutes},
            ${tx.json({ lines: result.lines, notes: result.notes, mode: result.mode, sqft_used: result.sqft_used, sqft_assumed: result.sqft_assumed, version: q.priced.version } as never)},
            ${result.requires_review}, ${result.review_reasons}, ${q.status}, ${q.source}, ${sha256(token)}, ${q.idempotencyKey ?? null},
            ${expires}, ${q.status === "accepted" ? new Date() : null}, ${q.createdBy ?? null})
    returning id, reference`;
  let sort = 0;
  for (const l of result.lines) {
    await tx`insert into quote_line_items (quote_id, kind, label, quantity, amount_cents, sort)
             values (${row.id}, ${l.kind}, ${l.label}, ${l.quantity}, ${l.amount_cents}, ${sort++})`;
  }
  return { ...row, token };
}

/** The amount a quote commits to: an admin override if one was recorded, otherwise the calculated estimate. */
export function quoteAmount(q: { estimate_cents: number; override_cents: number | null }): number {
  return q.override_cents ?? q.estimate_cents;
}
