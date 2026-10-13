import { z } from "zod";

export const FREQUENCIES = ["one_time", "weekly", "biweekly", "monthly", "quarterly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string> = {
  one_time: "One-time",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

export const CONDITIONS = ["light", "standard", "heavy", "extreme"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = {
  light: "Well kept — cleaned regularly",
  standard: "Average — due for a good clean",
  heavy: "Needs extra attention — noticeable buildup",
  extreme: "Major reset — heavy buildup or long overdue",
};

const cents = z.number().int().min(0).max(1_000_000);
const minutes = z.number().int().min(0).max(960);

const frequencyPrice = z.object({
  base_cents: cents,
  minimum_cents: cents,
});

export const serviceRulesSchema = z.object({
  /** "estimate" calculates a price; "custom" always routes to a manual quote. */
  quote_mode: z.enum(["estimate", "custom"]).default("estimate"),
  frequencies: z.partialRecord(z.enum(FREQUENCIES), frequencyPrice),
  included_bedrooms: z.number().int().min(0).max(10),
  included_full_baths: z.number().int().min(0).max(10),
  per_extra_bedroom_cents: cents,
  per_extra_full_bath_cents: cents,
  per_half_bath_cents: cents,
  base_minutes: minutes.min(30),
  minutes_per_extra_bedroom: minutes,
  minutes_per_extra_full_bath: minutes,
  minutes_per_half_bath: minutes,
});
export type ServiceRules = z.infer<typeof serviceRulesSchema>;

export const addonRulesSchema = z.object({
  price_cents: cents,
  unit: z.enum(["flat", "each"]),
  unit_label: z.string().max(30).default(""),
  max_quantity: z.number().int().min(1).max(50).default(1),
  minutes: minutes, // per unit
  applies_to: z.array(z.string()).default(["*"]), // service slugs, or "*" for all
  starting_at: z.boolean().default(false), // price is a floor; final amount confirmed on site
});
export type AddonRules = z.infer<typeof addonRulesSchema>;

export const adjustmentSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  kind: z.enum(["percent", "flat"]),
  value: z.number().min(-100_000).max(100_000), // percent (e.g. -10) or cents (e.g. -1500)
  services: z.array(z.string()).default(["*"]),
  frequencies: z.array(z.enum(FREQUENCIES)).default([]), // empty = all
  active: z.boolean().default(true),
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const pricingRulesSchema = z.object({
  services: z.record(z.string(), serviceRulesSchema),
  sqft_bands: z
    .array(
      z.object({
        up_to_sqft: z.number().int().min(100).max(50000).nullable(), // null = everything above the previous band
        adjust_cents: z.number().int().min(-100_000).max(1_000_000),
        adjust_minutes: z.number().int().min(-240).max(960),
      }),
    )
    .min(1),
  /** When the customer doesn't know their square footage, assume this size by bedroom count. */
  assumed_sqft_by_bedrooms: z.array(z.number().int().min(100).max(50000)).min(1),
  conditions: z.record(
    z.enum(CONDITIONS),
    z.object({ percent: z.number().min(0).max(200), minutes_percent: z.number().min(0).max(200), requires_review: z.boolean() }),
  ),
  pets: z.object({ fee_cents: cents, per_extra_pet_cents: cents, minutes: minutes }),
  addons: z.record(z.string(), addonRulesSchema),
  adjustments: z.array(adjustmentSchema).default([]),
  tax: z.object({ enabled: z.boolean(), percent: z.number().min(0).max(20), label: z.string().max(40) }),
  review: z.object({
    over_sqft: z.number().int().min(500).max(50000),
    over_bedrooms: z.number().int().min(1).max(20),
  }),
  rounding: z.enum(["none", "dollar", "five_dollars"]).default("dollar"),
});
export type PricingRules = z.infer<typeof pricingRulesSchema>;

/**
 * Initial draft configuration. Only the four recurring/Queen Reset floors came from the business
 * (weekly $165, biweekly $185, monthly $210, Queen Reset $275); add-on prices follow the owner's
 * printed price guide. Everything is editable in Admin → Pricing & Services.
 */
export const DEFAULT_RULES: PricingRules = {
  services: {
    recurring: {
      quote_mode: "estimate",
      frequencies: {
        weekly: { base_cents: 16500, minimum_cents: 16500 },
        biweekly: { base_cents: 18500, minimum_cents: 18500 },
        monthly: { base_cents: 21000, minimum_cents: 21000 },
      },
      included_bedrooms: 2,
      included_full_baths: 2,
      per_extra_bedroom_cents: 2000,
      per_extra_full_bath_cents: 2500,
      per_half_bath_cents: 1200,
      base_minutes: 150,
      minutes_per_extra_bedroom: 30,
      minutes_per_extra_full_bath: 30,
      minutes_per_half_bath: 15,
    },
    standard: {
      quote_mode: "estimate",
      frequencies: { one_time: { base_cents: 23500, minimum_cents: 23500 } },
      included_bedrooms: 2,
      included_full_baths: 2,
      per_extra_bedroom_cents: 2500,
      per_extra_full_bath_cents: 3000,
      per_half_bath_cents: 1500,
      base_minutes: 180,
      minutes_per_extra_bedroom: 30,
      minutes_per_extra_full_bath: 30,
      minutes_per_half_bath: 15,
    },
    deep: {
      quote_mode: "estimate",
      frequencies: { one_time: { base_cents: 27500, minimum_cents: 27500 } },
      included_bedrooms: 2,
      included_full_baths: 2,
      per_extra_bedroom_cents: 3500,
      per_extra_full_bath_cents: 4000,
      per_half_bath_cents: 2000,
      base_minutes: 240,
      minutes_per_extra_bedroom: 45,
      minutes_per_extra_full_bath: 45,
      minutes_per_half_bath: 20,
    },
    move: {
      quote_mode: "estimate",
      frequencies: { one_time: { base_cents: 32500, minimum_cents: 32500 } },
      included_bedrooms: 2,
      included_full_baths: 2,
      per_extra_bedroom_cents: 4000,
      per_extra_full_bath_cents: 4500,
      per_half_bath_cents: 2000,
      base_minutes: 300,
      minutes_per_extra_bedroom: 45,
      minutes_per_extra_full_bath: 45,
      minutes_per_half_bath: 20,
    },
    turnover: {
      quote_mode: "estimate",
      frequencies: { one_time: { base_cents: 15000, minimum_cents: 15000 } },
      included_bedrooms: 1,
      included_full_baths: 1,
      per_extra_bedroom_cents: 2500,
      per_extra_full_bath_cents: 2500,
      per_half_bath_cents: 1200,
      base_minutes: 120,
      minutes_per_extra_bedroom: 30,
      minutes_per_extra_full_bath: 25,
      minutes_per_half_bath: 10,
    },
    custom: {
      quote_mode: "custom",
      frequencies: { one_time: { base_cents: 0, minimum_cents: 0 } },
      included_bedrooms: 0,
      included_full_baths: 0,
      per_extra_bedroom_cents: 0,
      per_extra_full_bath_cents: 0,
      per_half_bath_cents: 0,
      base_minutes: 180,
      minutes_per_extra_bedroom: 0,
      minutes_per_extra_full_bath: 0,
      minutes_per_half_bath: 0,
    },
  },
  sqft_bands: [
    { up_to_sqft: 1500, adjust_cents: 0, adjust_minutes: 0 },
    { up_to_sqft: 2500, adjust_cents: 2500, adjust_minutes: 30 },
    { up_to_sqft: 3500, adjust_cents: 5000, adjust_minutes: 60 },
    { up_to_sqft: 4500, adjust_cents: 8500, adjust_minutes: 90 },
    { up_to_sqft: null, adjust_cents: 12500, adjust_minutes: 120 },
  ],
  assumed_sqft_by_bedrooms: [700, 900, 1300, 1800, 2400, 3200],
  conditions: {
    light: { percent: 0, minutes_percent: 0, requires_review: false },
    standard: { percent: 0, minutes_percent: 0, requires_review: false },
    heavy: { percent: 20, minutes_percent: 25, requires_review: false },
    extreme: { percent: 40, minutes_percent: 50, requires_review: true },
  },
  pets: { fee_cents: 0, per_extra_pet_cents: 0, minutes: 15 },
  addons: {
    "inside-oven": { price_cents: 2500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 30, applies_to: ["*"], starting_at: false },
    "inside-fridge": { price_cents: 3500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 30, applies_to: ["*"], starting_at: false },
    "inside-cabinets": { price_cents: 3500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 40, applies_to: ["*"], starting_at: false },
    "interior-windows": { price_cents: 1000, unit: "each", unit_label: "window", max_quantity: 40, minutes: 5, applies_to: ["*"], starting_at: false },
    baseboards: { price_cents: 2500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 30, applies_to: ["recurring", "standard", "turnover"], starting_at: true },
    "pet-hair": { price_cents: 2500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 20, applies_to: ["*"], starting_at: true },
    "heavy-buildup": { price_cents: 2500, unit: "flat", unit_label: "", max_quantity: 1, minutes: 30, applies_to: ["recurring", "standard", "turnover"], starting_at: true },
    "ceiling-fans": { price_cents: 1000, unit: "each", unit_label: "fan", max_quantity: 12, minutes: 10, applies_to: ["*"], starting_at: false },
    blinds: { price_cents: 1000, unit: "each", unit_label: "room", max_quantity: 15, minutes: 10, applies_to: ["*"], starting_at: false },
    "change-linens": { price_cents: 1000, unit: "each", unit_label: "bed", max_quantity: 10, minutes: 10, applies_to: ["recurring", "standard", "deep", "turnover"], starting_at: false },
    laundry: { price_cents: 3500, unit: "each", unit_label: "load", max_quantity: 5, minutes: 20, applies_to: ["recurring", "standard", "deep", "turnover"], starting_at: false },
    organization: { price_cents: 3000, unit: "each", unit_label: "hour", max_quantity: 8, minutes: 60, applies_to: ["*"], starting_at: false },
  },
  adjustments: [],
  tax: { enabled: false, percent: 0, label: "Tax" },
  review: { over_sqft: 4500, over_bedrooms: 6 },
  rounding: "dollar",
};

/** Human-readable problems with a rule set that zod alone cannot catch. */
export function lintRules(rules: PricingRules, knownAddonSlugs: string[] = []): string[] {
  const problems: string[] = [];
  for (const [slug, svc] of Object.entries(rules.services)) {
    const freqs = Object.entries(svc.frequencies);
    if (freqs.length === 0) problems.push(`Service "${slug}" has no frequency prices.`);
    for (const [f, p] of freqs) {
      if (!p) continue;
      if (svc.quote_mode === "estimate" && p.base_cents === 0)
        problems.push(`Service "${slug}" (${f}) has a $0 base price.`);
      if (p.minimum_cents > p.base_cents * 3 && p.base_cents > 0)
        problems.push(`Service "${slug}" (${f}) minimum is more than 3× its base price — check for a typo.`);
    }
  }
  const bands = rules.sqft_bands;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.up_to_sqft === null && i !== bands.length - 1)
      problems.push("Only the last square-footage band can be open-ended.");
    if (i > 0 && b.up_to_sqft !== null && bands[i - 1].up_to_sqft !== null && b.up_to_sqft <= bands[i - 1].up_to_sqft!)
      problems.push(`Square-footage band ${i + 1} must be larger than band ${i}.`);
    if (i > 0 && b.adjust_cents < bands[i - 1].adjust_cents)
      problems.push(`Square-footage band ${i + 1} charges less than a smaller home (band ${i}).`);
  }
  if (bands[bands.length - 1].up_to_sqft !== null) problems.push("The last square-footage band should be open-ended (no upper limit).");
  for (const adj of rules.adjustments) {
    if (adj.kind === "percent" && (adj.value < -50 || adj.value > 100))
      problems.push(`Adjustment "${adj.label}" is ${adj.value}% — that is unusually large.`);
  }
  for (const slug of Object.keys(rules.addons)) {
    if (knownAddonSlugs.length && !knownAddonSlugs.includes(slug))
      problems.push(`Add-on price "${slug}" has no matching add-on in the catalog.`);
  }
  for (const slug of knownAddonSlugs) {
    if (!rules.addons[slug]) problems.push(`Add-on "${slug}" has no price in this version, so customers cannot select it.`);
  }
  if (rules.tax.enabled && rules.tax.percent === 0) problems.push("Tax is enabled with a 0% rate.");
  return problems;
}
