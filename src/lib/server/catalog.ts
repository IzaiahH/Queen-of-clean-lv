import "server-only";
import { db, type Tx } from "@/lib/db";
import { pricingRulesSchema, type Frequency, type PricingRules } from "@/lib/pricing/rules";
import type { CatalogNames } from "@/lib/pricing/engine";

export type ServiceRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  description: string;
  includes: string[];
  excludes: string[];
  kind: string;
  allowed_frequencies: Frequency[];
  requires_review: boolean;
  active: boolean;
  sort: number;
};

export type AddonRow = { id: string; slug: string; name: string; description: string; active: boolean; sort: number };

export type AreaRow = {
  id: string;
  name: string;
  zip_codes: string[];
  travel_fee_cents: number;
  requires_review: boolean;
  active: boolean;
  sort: number;
};

export type PricingVersion = { id: string; version: number; status: string; rules: PricingRules; notes: string; published_at: Date | null; created_at: Date };

export async function listServices(tx: Tx = db(), onlyActive = false): Promise<ServiceRow[]> {
  return onlyActive
    ? tx<ServiceRow[]>`select * from services where active order by sort, name`
    : tx<ServiceRow[]>`select * from services order by sort, name`;
}

export async function listAddons(tx: Tx = db(), onlyActive = false): Promise<AddonRow[]> {
  return onlyActive
    ? tx<AddonRow[]>`select * from addons where active order by sort, name`
    : tx<AddonRow[]>`select * from addons order by sort, name`;
}

export async function listAreas(tx: Tx = db(), onlyActive = false): Promise<AreaRow[]> {
  return onlyActive
    ? tx<AreaRow[]>`select * from service_areas where active order by sort, name`
    : tx<AreaRow[]>`select * from service_areas order by sort, name`;
}

function parseVersion(row: PricingVersion & { rules: unknown }): PricingVersion {
  return { ...row, rules: pricingRulesSchema.parse(row.rules) };
}

export async function getPublishedPricing(tx: Tx = db()): Promise<PricingVersion> {
  const [row] = await tx<(PricingVersion & { rules: unknown })[]>`select * from pricing_versions where status = 'published'`;
  if (!row) throw new Error("No published pricing version. Run the seed script or publish pricing in Admin → Pricing.");
  return parseVersion(row);
}

export async function getPricingVersion(id: string, tx: Tx = db()): Promise<PricingVersion | null> {
  const [row] = await tx<(PricingVersion & { rules: unknown })[]>`select * from pricing_versions where id = ${id}`;
  return row ? parseVersion(row) : null;
}

export async function getDraftPricing(tx: Tx = db()): Promise<PricingVersion | null> {
  const [row] = await tx<(PricingVersion & { rules: unknown })[]>`select * from pricing_versions where status = 'draft'`;
  return row ? parseVersion(row) : null;
}

export function catalogNames(services: ServiceRow[], addons: AddonRow[]): CatalogNames {
  return {
    services: Object.fromEntries(services.map((s) => [s.slug, s.name])),
    addons: Object.fromEntries(addons.map((a) => [a.slug, a.name])),
  };
}

export type AreaMatch = { area: AreaRow | null; requires_review: boolean; travel_fee_cents: number; message: string | null };

/** Service-area rules: we never promise service to an address until its ZIP matches an active area. */
export function matchArea(areas: AreaRow[], zip: string, allowUnknown: boolean): AreaMatch | { rejected: true; message: string } {
  const z5 = zip.trim().slice(0, 5);
  const area = areas.find((a) => a.active && a.zip_codes.includes(z5)) ?? null;
  if (area) {
    return {
      area,
      requires_review: area.requires_review,
      travel_fee_cents: area.travel_fee_cents,
      message: area.requires_review ? `${area.name} addresses are confirmed after a quick review.` : null,
    };
  }
  if (!allowUnknown) return { rejected: true, message: "Sorry — that ZIP code is outside our current service area." };
  return { area: null, requires_review: true, travel_fee_cents: 0, message: "That ZIP code isn't in our listed service areas yet. We'll review it and let you know." };
}
