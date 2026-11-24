import { describe, expect, it } from "vitest";
import { calculateQuote, pickMatrixRow, type QuoteInput } from "@/lib/pricing/engine";
import { DEFAULT_RULES, lintRules, pricingRulesSchema, type PricingRules } from "@/lib/pricing/rules";

const names = { services: { recurring: "Recurring Home Cleaning", standard: "One-Time Standard Cleaning", deep: "Queen Reset" }, addons: { "inside-oven": "Inside oven", "inside-fridge": "Inside refrigerator", "interior-windows": "Interior windows" } };
const home: QuoteInput = { service: "recurring", frequency: "weekly", bedrooms: 1, full_baths: 1, half_baths: 0, sqft: null, condition: "standard", pets: 0, addons: [], travel_fee_cents: 0, area_requires_review: false };

function q(over: Partial<QuoteInput> = {}, rules: PricingRules = DEFAULT_RULES) {
  const r = calculateQuote(rules, { ...home, ...over }, names);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const base = (r: ReturnType<typeof q>) => r.lines.find((l) => l.kind === "base")!.amount_cents;

describe("new-customer starting-price table", () => {
  it("default rules validate and pass the publishing checks", () => {
    expect(pricingRulesSchema.safeParse(DEFAULT_RULES).success).toBe(true);
    expect(lintRules(DEFAULT_RULES)).toEqual([]);
  });

  it("matches every cell of the owner's table exactly", () => {
    const table: [number, number, number, number, number][] = [
      [1, 1, 12500, 15000, 17500],
      [2, 2, 15000, 17500, 21000],
      [3, 2, 17500, 20000, 25000],
      [3, 3, 19500, 22500, 27500],
      [4, 3, 22500, 26000, 31000],
      [4, 4, 25000, 29000, 35000],
    ];
    for (const [bedrooms, full_baths, weekly, biweekly, monthly] of table) {
      expect(q({ bedrooms, full_baths, frequency: "weekly" }).total_cents).toBe(weekly);
      expect(q({ bedrooms, full_baths, frequency: "biweekly" }).total_cents).toBe(biweekly);
      expect(q({ bedrooms, full_baths, frequency: "monthly" }).total_cents).toBe(monthly);
    }
  });

  it("required examples", () => {
    // 1 bed / 1 bath / 1,000 sq ft weekly starts at $125 before additional adjustments.
    const a = q({ sqft: 1000 });
    expect(base(a)).toBe(12500);
    expect(a.total_cents).toBe(12500);
    expect(q({ bedrooms: 2, full_baths: 2 }).total_cents).toBe(15000);
    expect(q({ bedrooms: 3, full_baths: 2, frequency: "biweekly" }).total_cents).toBe(20000);
    expect(q({ bedrooms: 3, full_baths: 3, frequency: "monthly" }).total_cents).toBe(27500);
  });

  it("weekly is the best rate; every 2 weeks and monthly cost more per visit", () => {
    for (const [b, f] of [[1, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]]) {
      const w = q({ bedrooms: b, full_baths: f, frequency: "weekly" }).total_cents;
      const bw = q({ bedrooms: b, full_baths: f, frequency: "biweekly" }).total_cents;
      const m = q({ bedrooms: b, full_baths: f, frequency: "monthly" }).total_cents;
      expect(w).toBeLessThan(bw);
      expect(bw).toBeLessThan(m);
    }
  });

  it("additional bathrooms raise the estimate", () => {
    const two = q({ bedrooms: 3, full_baths: 2 }).total_cents;
    expect(q({ bedrooms: 3, full_baths: 2, half_baths: 1 }).total_cents).toBeGreaterThan(two);
    expect(q({ bedrooms: 3, full_baths: 3 }).total_cents).toBeGreaterThan(two);
    // 5 full baths on a 4-bed home goes beyond the table: charged on top of 4 bed / 4 bath.
    expect(q({ bedrooms: 4, full_baths: 5 }).total_cents).toBe(25000 + DEFAULT_RULES.services.recurring.per_extra_full_bath_cents);
  });

  it("square footage changes the estimate: a large home costs more than a small one with the same rooms", () => {
    const small = q({ bedrooms: 2, full_baths: 2, sqft: 1000 });
    const large = q({ bedrooms: 2, full_baths: 2, sqft: 2500 });
    expect(small.total_cents).toBe(15000); // never discounted below the starting price
    // 2,500 − 1,300 typical = 12 steps of 100 sq ft × $5
    expect(large.total_cents).toBe(15000 + 12 * 500);
    expect(large.lines.find((l) => l.kind === "size")!.label).toMatch(/2,500 sq ft/);
  });

  it("homes between table rows start from the closest row they contain and add the difference", () => {
    // 2 bed / 1 bath contains 1/1 (not 2/2, which has more bathrooms): $125 + one bedroom.
    expect(pickMatrixRow(DEFAULT_RULES.services.recurring.matrix, "weekly", 2, 1)?.bedrooms).toBe(1);
    expect(q({ bedrooms: 2, full_baths: 1 }).total_cents).toBe(12500 + DEFAULT_RULES.services.recurring.per_extra_bedroom_cents);
    // 4 bed / 2 bath starts from 3 bed / 2 bath (the biggest it contains), not the cheapest row.
    expect(q({ bedrooms: 4, full_baths: 2 }).total_cents).toBe(17500 + DEFAULT_RULES.services.recurring.per_extra_bedroom_cents);
    // 5 bed / 4 bath: 4/4 + a bedroom, and the expected size grows with the extra bedroom.
    expect(q({ bedrooms: 5, full_baths: 4, sqft: 3400 }).total_cents).toBe(25000 + DEFAULT_RULES.services.recurring.per_extra_bedroom_cents);
    // A studio (0 bed) is never priced below the smallest row.
    expect(q({ bedrooms: 0, full_baths: 1 }).total_cents).toBe(12500);
  });

  it("pets and home condition adjust the price", () => {
    const plain = q({ bedrooms: 3, full_baths: 2 }).total_cents;
    const pets = q({ bedrooms: 3, full_baths: 2, pets: 2 });
    expect(pets.lines.find((l) => l.kind === "pets")!.amount_cents).toBe(DEFAULT_RULES.pets.fee_cents + DEFAULT_RULES.pets.per_extra_pet_cents);
    expect(pets.total_cents).toBeGreaterThan(plain);
    const normal = q({ bedrooms: 3, full_baths: 2, condition: "standard" }).total_cents;
    const moderate = q({ bedrooms: 3, full_baths: 2, condition: "heavy" }).total_cents;
    const heavy = q({ bedrooms: 3, full_baths: 2, condition: "extreme" });
    expect(normal).toBe(plain);
    expect(moderate).toBe(Math.round(plain * 1.2));
    expect(heavy.total_cents).toBeGreaterThan(moderate);
    expect(heavy.requires_review).toBe(true);
  });

  it("extras are added at their configured prices", () => {
    const r = q({ bedrooms: 3, full_baths: 2, addons: [{ slug: "inside-fridge", quantity: 1 }, { slug: "inside-oven", quantity: 1 }, { slug: "interior-windows", quantity: 4 }] });
    expect(r.total_cents).toBe(17500 + 3500 + 2500 + 4 * 1000);
  });

  it("deep and one-time cleaning use their own prices, never the recurring table", () => {
    const deep = q({ service: "deep", frequency: "one_time", bedrooms: 3, full_baths: 2, sqft: 1700 });
    expect(deep.matched_row).toBeNull();
    expect(base(deep)).toBe(DEFAULT_RULES.services.deep.frequencies.one_time!.base_cents);
    const std = q({ service: "standard", frequency: "one_time", bedrooms: 3, full_baths: 2, sqft: 1700 });
    expect(std.matched_row).toBeNull();
    expect(deep.total_cents).toBeGreaterThan(std.total_cents);
    expect(deep.estimated_minutes).toBeGreaterThan(std.estimated_minutes);
    expect(deep.first_visit_cents).toBeNull();
    // Changing the recurring table doesn't move deep or one-time prices.
    const rules = structuredClone(DEFAULT_RULES);
    for (const row of rules.services.recurring.matrix) for (const f of Object.keys(row.prices) as (keyof typeof row.prices)[]) row.prices[f]! += 5000;
    expect(q({ service: "deep", frequency: "one_time", bedrooms: 3, full_baths: 2, sqft: 1700 }, rules).total_cents).toBe(deep.total_cents);
  });

  it("prices the initial clean before a recurring plan separately", () => {
    const r = q({ bedrooms: 3, full_baths: 2, frequency: "biweekly" });
    expect(r.recurring_per_visit_cents).toBe(20000);
    expect(r.first_visit_cents).toBe(30000); // +50% of the cleaning price
    expect(r.first_visit_minutes!).toBeGreaterThan(r.estimated_minutes);
    expect(q({ frequency: "weekly" }).first_visit_cents).toBe(22500); // never below the initial-clean minimum
    const off = structuredClone(DEFAULT_RULES);
    off.services.recurring.initial_clean!.enabled = false;
    expect(q({ bedrooms: 3, full_baths: 2, frequency: "biweekly" }, off).first_visit_cents).toBeNull();
  });

  it("older saved price versions (no table) still parse and price the old way", () => {
    const old = structuredClone(DEFAULT_RULES) as unknown as Record<string, unknown> & { services: Record<string, Record<string, unknown>> };
    for (const svc of Object.values(old.services)) {
      delete svc.matrix; delete svc.matrix_cents_per_100_sqft_over; delete svc.matrix_minutes_per_100_sqft_over; delete svc.matrix_sqft_per_extra_bedroom; delete svc.initial_clean;
    }
    const parsed = pricingRulesSchema.parse(old);
    expect(parsed.services.recurring.matrix).toEqual([]);
    const r = calculateQuote(parsed, { ...home, bedrooms: 2, full_baths: 2, sqft: 1200 }, names);
    expect(r.ok && r.matched_row).toBeNull();
  });

  it("publishing checks catch a table typo", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.services.recurring.matrix[3].prices.weekly = 9000; // 3/3 cheaper than 3/2
    expect(lintRules(rules).join(" ")).toMatch(/costs less than a smaller home/);
  });
});

describe("publishing checks for the table", () => {
  it("warns when an old minimum is above the table's cheapest price", () => {
    const rules = structuredClone(DEFAULT_RULES);
    rules.services.recurring.frequencies.weekly = { base_cents: 16500, minimum_cents: 16500 };
    expect(lintRules(rules).join(" ")).toMatch(/minimum \(\$165\) is above the cheapest starting price \(\$125\)/);
  });
});
