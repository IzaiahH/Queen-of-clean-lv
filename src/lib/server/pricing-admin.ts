import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { calculateQuote, quoteInputSchema } from "@/lib/pricing/engine";
import { FREQUENCIES, lintRules, pricingRulesSchema, type PricingRules } from "@/lib/pricing/rules";
import { audit, type Actor } from "./audit";
import { catalogNames, getDraftPricing, getPublishedPricing, listAddons, listServices } from "./catalog";

export async function listVersions() {
  const rows = await db()<{ id: string; version: number; status: string; notes: string; created_at: Date; published_at: Date | null; published_by_name: string | null; quotes: number }[]>`
    select v.id, v.version, v.status, v.notes, v.created_at, v.published_at, p.full_name as published_by_name,
           (select count(*)::int from quotes q where q.pricing_version_id = v.id) as quotes
      from pricing_versions v left join profiles p on p.id = v.published_by order by v.version desc`;
  return Array.from(rows).map((r) => ({ ...r }));
}

export async function startDraft(actor: Actor) {
  return db().begin(async (tx) => {
    const existing = await getDraftPricing(tx);
    if (existing) return existing.id;
    const pub = await getPublishedPricing(tx);
    const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(version), 0) + 1 as next from pricing_versions`;
    const [row] = await tx<{ id: string }[]>`
      insert into pricing_versions (version, status, rules, notes, created_by) values (${next}, 'draft', ${tx.json(pub.rules as never)}, '', ${actor.id}) returning id`;
    await audit(actor, "pricing.draft_start", "pricing_version", row.id, { from_version: pub.version }, tx);
    return row.id;
  });
}

export async function saveDraft(actor: Actor, rules: unknown, notes: string) {
  const parsed = pricingRulesSchema.safeParse(rules);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(" › ")}: ${i.message}`).join("; ") };
  const r = await db()`update pricing_versions set rules = ${db().json(parsed.data as never)}, notes = ${notes} where status = 'draft'`;
  if (!r.count) return { ok: false as const, error: "There's no draft to save. Start a new draft first." };
  await audit(actor, "pricing.draft_save", "pricing_version", null);
  const addons = await listAddons();
  return { ok: true as const, warnings: lintRules(parsed.data, addons.filter((a) => a.active).map((a) => a.slug)) };
}

/** Publishing archives the current version; quotes keep pointing at the version they were priced with. */
export async function publishDraft(actor: Actor, notes: string) {
  return db().begin(async (tx) => {
    const draft = await getDraftPricing(tx);
    if (!draft) return { ok: false as const, error: "There's no draft to publish." };
    const services = await listServices(tx, true);
    const missing = services.filter((s) => !draft.rules.services[s.slug]).map((s) => s.name);
    if (missing.length) return { ok: false as const, error: `Add prices for: ${missing.join(", ")} (or turn those services off) before publishing.` };
    await tx`update pricing_versions set status = 'archived' where status = 'published'`;
    await tx`update pricing_versions set status = 'published', published_at = now(), published_by = ${actor.id}, notes = ${notes || draft.notes} where id = ${draft.id}`;
    await audit(actor, "pricing.publish", "pricing_version", draft.id, { version: draft.version }, tx);
    return { ok: true as const, version: draft.version };
  });
}

export async function discardDraft(actor: Actor) {
  const r = await db()`delete from pricing_versions where status = 'draft' and not exists (select 1 from quotes q where q.pricing_version_id = pricing_versions.id)`;
  await audit(actor, "pricing.draft_discard", "pricing_version", null, { deleted: r.count });
  return { ok: true as const };
}

export const testInputSchema = quoteInputSchema.extend({ frequency: z.enum(FREQUENCIES) });

/** Prices an example home with the given (possibly unsaved) rules and with the published rules, side by side. */
export async function testRules(rules: unknown, input: unknown) {
  const parsed = pricingRulesSchema.safeParse(rules);
  if (!parsed.success) return { ok: false as const, error: "The draft has invalid values. Fix the highlighted fields first." };
  const i = testInputSchema.parse(input);
  const [services, addons, published] = await Promise.all([listServices(), listAddons(), getPublishedPricing()]);
  const names = catalogNames(services, addons);
  const run = (r: PricingRules) => {
    const out = calculateQuote(r, i, names);
    if (!out.ok) return { error: out.error };
    return { total_cents: out.total_cents, minutes: out.estimated_minutes, lines: out.lines.map((l) => ({ label: l.label, amount_cents: l.amount_cents })), review: out.review_reasons, mode: out.mode };
  };
  return { ok: true as const, draft: run(parsed.data), published: run(published.rules), published_version: published.version };
}

export const serviceEditSchema = z.object({
  name: z.string().trim().min(1).max(80),
  short_description: z.string().max(300),
  description: z.string().max(3000),
  includes: z.array(z.string().trim().min(1).max(200)).max(40),
  excludes: z.array(z.string().trim().min(1).max(200)).max(40),
  allowed_frequencies: z.array(z.enum(FREQUENCIES)).min(1, "Choose at least one frequency"),
  requires_review: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(999),
});

export async function saveService(actor: Actor, id: string | null, input: z.input<typeof serviceEditSchema> & { slug?: string; kind?: string }) {
  const d = serviceEditSchema.parse(input);
  if (!id) {
    const slug = z.string().regex(/^[a-z0-9-]{2,40}$/, "Use lowercase letters, numbers and dashes for the short code").parse(input.slug);
    const kind = z.enum(["recurring", "standard", "deep", "move", "turnover", "custom"]).parse(input.kind ?? "custom");
    const [row] = await db()<{ id: string }[]>`
      insert into services (slug, name, short_description, description, includes, excludes, kind, allowed_frequencies, requires_review, active, sort)
      values (${slug}, ${d.name}, ${d.short_description}, ${d.description}, ${d.includes}, ${d.excludes}, ${kind}, ${d.allowed_frequencies}, ${d.requires_review}, ${d.active}, ${d.sort})
      returning id`;
    await audit(actor, "service.create", "service", row.id, { slug });
    return row.id;
  }
  if (d.active) {
    const [svc] = await db()<{ slug: string }[]>`select slug from services where id = ${id}`;
    const pub = await getPublishedPricing();
    if (svc && !pub.rules.services[svc.slug]) throw new Error("This service has no price in the published pricing. Add it to a draft and publish before turning it on.");
  }
  await db()`
    update services set name = ${d.name}, short_description = ${d.short_description}, description = ${d.description}, includes = ${d.includes}, excludes = ${d.excludes},
           allowed_frequencies = ${d.allowed_frequencies}, requires_review = ${d.requires_review}, active = ${d.active}, sort = ${d.sort}
     where id = ${id}`;
  await audit(actor, "service.update", "service", id);
  return id;
}

export const addonEditSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500), active: z.boolean(), sort: z.number().int().min(0).max(999) });

export async function saveAddon(actor: Actor, id: string | null, input: z.input<typeof addonEditSchema> & { slug?: string }) {
  const d = addonEditSchema.parse(input);
  if (!id) {
    const slug = z.string().regex(/^[a-z0-9-]{2,60}$/, "Use lowercase letters, numbers and dashes for the short code").parse(input.slug);
    const [row] = await db()<{ id: string }[]>`insert into addons (slug, name, description, active, sort) values (${slug}, ${d.name}, ${d.description}, ${d.active}, ${d.sort}) returning id`;
    await audit(actor, "addon.create", "addon", row.id, { slug });
    return row.id;
  }
  await db()`update addons set name = ${d.name}, description = ${d.description}, active = ${d.active}, sort = ${d.sort} where id = ${id}`;
  await audit(actor, "addon.update", "addon", id);
  return id;
}

export const areaEditSchema = z.object({
  name: z.string().trim().min(1).max(80),
  zip_codes: z.array(z.string().regex(/^\d{5}$/, "ZIP codes must be 5 digits")).max(200),
  travel_fee_cents: z.number().int().min(0).max(50_000),
  requires_review: z.boolean(),
  active: z.boolean(),
  sort: z.number().int().min(0).max(999),
});

export async function saveArea(actor: Actor, id: string | null, input: z.input<typeof areaEditSchema>) {
  const d = areaEditSchema.parse(input);
  if (!id) {
    const [row] = await db()<{ id: string }[]>`
      insert into service_areas (name, zip_codes, travel_fee_cents, requires_review, active, sort) values (${d.name}, ${d.zip_codes}, ${d.travel_fee_cents}, ${d.requires_review}, ${d.active}, ${d.sort}) returning id`;
    await audit(actor, "area.create", "service_area", row.id);
    return row.id;
  }
  await db()`update service_areas set name = ${d.name}, zip_codes = ${d.zip_codes}, travel_fee_cents = ${d.travel_fee_cents}, requires_review = ${d.requires_review}, active = ${d.active}, sort = ${d.sort} where id = ${id}`;
  await audit(actor, "area.update", "service_area", id);
  return id;
}
