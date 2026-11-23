import { FREQUENCIES, type Frequency, type PricingRules } from "./rules";

/**
 * "Starting at" figures for marketing pages, read from the published pricing rules so the site never
 * shows a price the calculator wouldn't produce. Returns null when a service is custom-quoted or unpriced.
 */
export function startingPrices(rules: PricingRules, slug: string): { frequency: Frequency; cents: number }[] | null {
  const svc = rules.services[slug];
  if (!svc || svc.quote_mode === "custom") return null;
  const out = FREQUENCIES.flatMap((f) => {
    const p = svc.frequencies[f];
    return p ? [{ frequency: f, cents: Math.max(p.base_cents, p.minimum_cents) }] : [];
  });
  return out.length ? out : null;
}

export function lowestStartingPrice(rules: PricingRules, slug: string): number | null {
  const prices = startingPrices(rules, slug);
  return prices ? Math.min(...prices.map((p) => p.cents)) : null;
}
