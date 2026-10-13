import { z } from "zod";
import { CONDITIONS, FREQUENCIES, FREQUENCY_LABELS, type Frequency, type PricingRules } from "./rules";

export const quoteInputSchema = z.object({
  service: z.string().min(1).max(40),
  frequency: z.enum(FREQUENCIES),
  bedrooms: z.number().int().min(0).max(20),
  full_baths: z.number().int().min(0).max(20),
  half_baths: z.number().int().min(0).max(20).default(0),
  sqft: z.number().int().min(100).max(50000).nullable(), // null = "Not sure"
  condition: z.enum(CONDITIONS).nullable(), // null = "Not sure" → treated as standard + review note
  pets: z.number().int().min(0).max(20).default(0),
  addons: z
    .array(z.object({ slug: z.string().min(1).max(60), quantity: z.number().int().min(1).max(50) }))
    .max(30)
    .default([]),
  travel_fee_cents: z.number().int().min(0).max(100_000).default(0),
  area_requires_review: z.boolean().default(false),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export type LineItem = {
  kind:
    | "base"
    | "bedrooms"
    | "bathrooms"
    | "half_baths"
    | "size"
    | "condition"
    | "pets"
    | "addon"
    | "adjustment"
    | "minimum"
    | "travel"
    | "rounding"
    | "tax";
  label: string;
  quantity: number;
  amount_cents: number;
};

export type QuoteResult = {
  ok: true;
  mode: "estimate" | "custom";
  lines: LineItem[];
  subtotal_cents: number;
  total_cents: number;
  /** For recurring frequencies, the price of each visit (equals total). Null for one-time cleans. */
  recurring_per_visit_cents: number | null;
  frequency: Frequency;
  estimated_minutes: number;
  requires_review: boolean;
  review_reasons: string[];
  notes: string[];
  sqft_used: number;
  sqft_assumed: boolean;
};

export type QuoteError = { ok: false; error: string };

/** Customer-safe add-on/service names come from the catalog, not the rule set. */
export type CatalogNames = { services: Record<string, string>; addons: Record<string, string> };

function roundTotal(cents: number, mode: PricingRules["rounding"]): number {
  if (mode === "dollar") return Math.round(cents / 100) * 100;
  if (mode === "five_dollars") return Math.round(cents / 500) * 500;
  return cents;
}

function pct(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}

/**
 * Deterministic: the same input and the same rule set always produce the same result.
 * No clocks, randomness or I/O.
 */
export function calculateQuote(rules: PricingRules, rawInput: QuoteInput, names: CatalogNames): QuoteResult | QuoteError {
  const parsed = quoteInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: "Some property details are missing or invalid." };
  const input = parsed.data;

  const svc = rules.services[input.service];
  if (!svc) return { ok: false, error: "That service is not available." };
  const freq = svc.frequencies[input.frequency];
  if (!freq) return { ok: false, error: `${FREQUENCY_LABELS[input.frequency]} is not offered for this service.` };

  const serviceName = names.services[input.service] ?? input.service;
  const lines: LineItem[] = [];
  const reviewReasons: string[] = [];
  const notes: string[] = [];
  let minutes = svc.base_minutes;

  // Size used for banding: what the customer told us, or an assumption from bedroom count.
  const assumed = rules.assumed_sqft_by_bedrooms;
  const sqftAssumed = input.sqft === null;
  const sqftUsed = input.sqft ?? assumed[Math.min(input.bedrooms, assumed.length - 1)];
  if (sqftAssumed) notes.push(`Square footage not provided — estimated as about ${sqftUsed.toLocaleString()} sq ft from the bedroom count.`);

  if (svc.quote_mode === "custom") {
    reviewReasons.push("Custom requests are priced individually after we review the details.");
    for (const a of input.addons) {
      const ar = rules.addons[a.slug];
      if (ar) minutes += ar.minutes * a.quantity;
    }
    return {
      ok: true,
      mode: "custom",
      lines: [],
      subtotal_cents: 0,
      total_cents: 0,
      recurring_per_visit_cents: null,
      frequency: input.frequency,
      estimated_minutes: minutes,
      requires_review: true,
      review_reasons: reviewReasons,
      notes,
      sqft_used: sqftUsed,
      sqft_assumed: sqftAssumed,
    };
  }

  lines.push({
    kind: "base",
    label: `${serviceName} — ${FREQUENCY_LABELS[input.frequency]} (includes ${svc.included_bedrooms} bed / ${svc.included_full_baths} bath)`,
    quantity: 1,
    amount_cents: freq.base_cents,
  });

  const extraBeds = Math.max(0, input.bedrooms - svc.included_bedrooms);
  if (extraBeds > 0) {
    lines.push({ kind: "bedrooms", label: `Additional bedrooms`, quantity: extraBeds, amount_cents: extraBeds * svc.per_extra_bedroom_cents });
    minutes += extraBeds * svc.minutes_per_extra_bedroom;
  }
  const extraBaths = Math.max(0, input.full_baths - svc.included_full_baths);
  if (extraBaths > 0) {
    lines.push({ kind: "bathrooms", label: `Additional full bathrooms`, quantity: extraBaths, amount_cents: extraBaths * svc.per_extra_full_bath_cents });
    minutes += extraBaths * svc.minutes_per_extra_full_bath;
  }
  if (input.half_baths > 0) {
    lines.push({ kind: "half_baths", label: `Half bathrooms`, quantity: input.half_baths, amount_cents: input.half_baths * svc.per_half_bath_cents });
    minutes += input.half_baths * svc.minutes_per_half_bath;
  }

  const band = rules.sqft_bands.find((b) => b.up_to_sqft === null || sqftUsed <= b.up_to_sqft) ?? rules.sqft_bands[rules.sqft_bands.length - 1];
  if (band.adjust_cents !== 0) {
    lines.push({
      kind: "size",
      label: `Home size (${sqftAssumed ? "estimated " : ""}${sqftUsed.toLocaleString()} sq ft)`,
      quantity: 1,
      amount_cents: band.adjust_cents,
    });
  }
  minutes += band.adjust_minutes;

  // Condition applies to the cleaning itself (base + rooms + size), not to add-ons.
  const cleaningSubtotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  const condition = input.condition ?? "standard";
  if (input.condition === null) notes.push("Home condition not specified — priced as average; we'll confirm on arrival.");
  const cond = rules.conditions[condition];
  if (cond.percent > 0) {
    lines.push({ kind: "condition", label: `Condition adjustment (+${cond.percent}%)`, quantity: 1, amount_cents: pct(cleaningSubtotal, cond.percent) });
  }
  minutes += Math.round((minutes * cond.minutes_percent) / 100);
  if (cond.requires_review) reviewReasons.push("Homes needing a major reset are confirmed after a quick review or walkthrough.");

  if (input.pets > 0) {
    const petAmount = rules.pets.fee_cents + Math.max(0, input.pets - 1) * rules.pets.per_extra_pet_cents;
    if (petAmount > 0) lines.push({ kind: "pets", label: `Pets in the home`, quantity: input.pets, amount_cents: petAmount });
    minutes += rules.pets.minutes;
  }

  for (const a of input.addons) {
    const ar = rules.addons[a.slug];
    if (!ar) return { ok: false, error: "One of the selected extras is no longer available." };
    if (!ar.applies_to.includes("*") && !ar.applies_to.includes(input.service))
      return { ok: false, error: `${names.addons[a.slug] ?? a.slug} is not available with ${serviceName}.` };
    const qty = ar.unit === "flat" ? 1 : Math.min(a.quantity, ar.max_quantity);
    const label = `${names.addons[a.slug] ?? a.slug}${ar.unit === "each" ? ` (${qty} ${ar.unit_label}${qty === 1 ? "" : "s"})` : ""}${ar.starting_at ? " — starting at" : ""}`;
    lines.push({ kind: "addon", label, quantity: qty, amount_cents: ar.price_cents * qty });
    minutes += ar.minutes * qty;
    if (ar.starting_at) notes.push(`${names.addons[a.slug] ?? a.slug} is a starting price and may increase depending on what we find.`);
  }

  for (const adj of rules.adjustments) {
    if (!adj.active) continue;
    if (!adj.services.includes("*") && !adj.services.includes(input.service)) continue;
    if (adj.frequencies.length > 0 && !adj.frequencies.includes(input.frequency)) continue;
    const running = lines.reduce((s, l) => s + l.amount_cents, 0);
    const amount = adj.kind === "percent" ? pct(running, adj.value) : Math.round(adj.value);
    if (amount !== 0) lines.push({ kind: "adjustment", label: adj.label, quantity: 1, amount_cents: amount });
  }

  let subtotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  if (subtotal < freq.minimum_cents) {
    lines.push({ kind: "minimum", label: "Minimum service price", quantity: 1, amount_cents: freq.minimum_cents - subtotal });
    subtotal = freq.minimum_cents;
  }

  if (input.travel_fee_cents > 0) {
    lines.push({ kind: "travel", label: "Travel fee for your area", quantity: 1, amount_cents: input.travel_fee_cents });
    subtotal += input.travel_fee_cents;
  }

  const rounded = roundTotal(subtotal, rules.rounding);
  if (rounded !== subtotal) {
    lines.push({ kind: "rounding", label: "Rounding", quantity: 1, amount_cents: rounded - subtotal });
  }
  let total = rounded;
  if (rules.tax.enabled && rules.tax.percent > 0) {
    const tax = pct(rounded, rules.tax.percent);
    lines.push({ kind: "tax", label: `${rules.tax.label} (${rules.tax.percent}%)`, quantity: 1, amount_cents: tax });
    total += tax;
  }

  if (sqftUsed > rules.review.over_sqft) reviewReasons.push("Larger homes are confirmed after a quick review.");
  if (input.bedrooms > rules.review.over_bedrooms) reviewReasons.push("Homes with many bedrooms are confirmed after a quick review.");
  if (input.area_requires_review) reviewReasons.push("Your address needs a quick service-area check before we confirm.");

  return {
    ok: true,
    mode: "estimate",
    lines,
    subtotal_cents: rounded,
    total_cents: total,
    recurring_per_visit_cents: input.frequency === "one_time" ? null : total,
    frequency: input.frequency,
    estimated_minutes: Math.max(30, Math.round(minutes / 15) * 15),
    requires_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    notes,
    sqft_used: sqftUsed,
    sqft_assumed: sqftAssumed,
  };
}
