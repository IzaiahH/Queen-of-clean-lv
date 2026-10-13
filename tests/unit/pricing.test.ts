import { describe, expect, it } from "vitest";
import { calculateQuote, type QuoteInput } from "@/lib/pricing/engine";
import { DEFAULT_RULES, lintRules, pricingRulesSchema, type PricingRules } from "@/lib/pricing/rules";

const names = { services: { recurring: "Recurring Home Cleaning", deep: "Queen Reset", custom: "Custom" }, addons: { "inside-oven": "Inside oven", "interior-windows": "Interior windows", baseboards: "Baseboards" } };
const base: QuoteInput = { service: "recurring", frequency: "biweekly", bedrooms: 2, full_baths: 2, half_baths: 0, sqft: 1200, condition: "standard", pets: 0, addons: [], travel_fee_cents: 0, area_requires_review: false };

function quote(over: Partial<QuoteInput> = {}, rules: PricingRules = DEFAULT_RULES) {
  const r = calculateQuote(rules, { ...base, ...over }, names);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("pricing engine", () => {
  it("default rules validate", () => {
    expect(pricingRulesSchema.safeParse(DEFAULT_RULES).success).toBe(true);
    expect(lintRules(DEFAULT_RULES)).toEqual([]);
  });

  it("uses the configured recurring floors for a reference home", () => {
    expect(quote({ frequency: "weekly" }).total_cents).toBe(16500);
    expect(quote({ frequency: "biweekly" }).total_cents).toBe(18500);
    expect(quote({ frequency: "monthly" }).total_cents).toBe(21000);
    expect(quote({ service: "deep", frequency: "one_time" }).total_cents).toBe(27500);
  });

  it("adds bedrooms, bathrooms, half baths and size bands with a transparent breakdown", () => {
    const r = quote({ bedrooms: 4, full_baths: 3, half_baths: 1, sqft: 2800 });
    // 18500 + 2×2000 + 1×2500 + 1×1200 + 5000 (2501–3500 band)
    expect(r.total_cents).toBe(31200);
    expect(r.lines.map((l) => l.kind)).toEqual(["base", "bedrooms", "bathrooms", "half_baths", "size"]);
    expect(r.lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(r.total_cents);
    expect(r.recurring_per_visit_cents).toBe(31200);
  });

  it("is deterministic for the same inputs and rules", () => {
    const a = quote({ bedrooms: 5, sqft: null, condition: "heavy", pets: 2, addons: [{ slug: "interior-windows", quantity: 6 }] });
    const b = quote({ bedrooms: 5, sqft: null, condition: "heavy", pets: 2, addons: [{ slug: "interior-windows", quantity: 6 }] });
    expect(a).toEqual(b);
  });

  it("applies condition surcharge to the cleaning but not to add-ons", () => {
    const r = quote({ condition: "heavy", addons: [{ slug: "inside-oven", quantity: 1 }] });
    const cond = r.lines.find((l) => l.kind === "condition")!;
    expect(cond.amount_cents).toBe(3700); // 20% of 18500
    expect(r.total_cents).toBe(18500 + 3700 + 2500);
  });

  it("flags extreme condition, large homes and unknown areas for review", () => {
    expect(quote({ condition: "extreme" }).requires_review).toBe(true);
    expect(quote({ sqft: 6000 }).requires_review).toBe(true);
    expect(quote({ area_requires_review: true }).review_reasons.length).toBe(1);
    expect(quote().requires_review).toBe(false);
  });

  it("supports 'not sure' square footage by assuming a size from bedrooms", () => {
    const r = quote({ sqft: null, bedrooms: 4 });
    expect(r.sqft_assumed).toBe(true);
    expect(r.sqft_used).toBe(2400);
    expect(r.notes.join(" ")).toMatch(/estimated/);
  });

  it("enforces minimum price and adds travel fees", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.services.recurring.frequencies.biweekly = { base_cents: 10000, minimum_cents: 15000 };
    const r = quote({ travel_fee_cents: 1500 }, rules);
    expect(r.lines.find((l) => l.kind === "minimum")!.amount_cents).toBe(5000);
    expect(r.total_cents).toBe(16500);
  });

  it("caps per-unit add-ons at their maximum and rejects add-ons not allowed for a service", () => {
    const r = quote({ addons: [{ slug: "interior-windows", quantity: 50 }] });
    expect(r.lines.find((l) => l.kind === "addon")!.quantity).toBe(40);
    const bad = calculateQuote(DEFAULT_RULES, { ...base, service: "deep", frequency: "one_time", addons: [{ slug: "baseboards", quantity: 1 }] }, names);
    expect(bad.ok).toBe(false);
  });

  it("rejects frequencies a service does not offer", () => {
    const r = calculateQuote(DEFAULT_RULES, { ...base, service: "deep", frequency: "weekly" }, names);
    expect(r.ok).toBe(false);
  });

  it("routes custom services to manual review with no price", () => {
    const r = quote({ service: "custom", frequency: "one_time" });
    expect(r.mode).toBe("custom");
    expect(r.total_cents).toBe(0);
    expect(r.requires_review).toBe(true);
  });

  it("applies admin adjustments scoped by service and frequency", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.adjustments = [{ id: "weekly-10", label: "Weekly loyalty", kind: "percent", value: -10, services: ["recurring"], frequencies: ["weekly"], active: true }];
    const big = quote({ frequency: "weekly", bedrooms: 4 }, rules);
    expect(big.lines.find((l) => l.kind === "adjustment")!.amount_cents).toBe(-2050); // 10% of 16500 + 2×2000
    expect(big.total_cents).toBe(18500); // 18450 rounded to the dollar
    // Discounts never take a visit below the configured floor.
    expect(quote({ frequency: "weekly" }, rules).total_cents).toBe(16500);
    // Not applied to other frequencies.
    expect(quote({ frequency: "biweekly", bedrooms: 4 }, rules).lines.some((l) => l.kind === "adjustment")).toBe(false);
  });

  it("changing rules changes new quotes only through a new rule set", () => {
    const v2 = structuredClone(DEFAULT_RULES);
    v2.services.recurring.frequencies.biweekly = { base_cents: 19500, minimum_cents: 19500 };
    expect(quote({}, DEFAULT_RULES).total_cents).toBe(18500);
    expect(quote({}, v2).total_cents).toBe(19500);
  });

  it("lint catches conflicting bands", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.sqft_bands[2].up_to_sqft = 1000;
    expect(lintRules(rules).length).toBeGreaterThan(0);
  });
});
