/**
 * Import of the business's existing customers and their historical (per-customer) rates.
 *
 * Shared by the admin page (Import / Export → Existing customers) and `npm run import:existing`.
 * It takes the database connection as an argument and has no Next.js imports, so it runs in both.
 *
 * Rules:
 *  - Records are matched only by their `ref` (stored as customers.import_ref). Re-running never creates duplicates.
 *  - Nothing that already exists is ever overwritten. Differences are reported as conflicts for a person to resolve.
 *  - A customer with the same name that wasn't created by this import is reported as a possible duplicate and skipped.
 *  - Historical rates are stored exactly as given, in customer_rates. They are never recalculated by the pricing engine.
 *  - No appointments, schedules, invoices or payments are created, and missing details are left blank, never guessed.
 *  - A dry run executes everything inside a transaction and then rolls it back, so its report is exactly what applying would do.
 */
import type postgres from "postgres";
import { z } from "zod";

type Sql = postgres.Sql<Record<string, unknown>>;

export const IMPORT_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "one_time"] as const;
export const UNVERIFIED_LABEL = "Existing client — verify current status";

const money = z
  .number()
  .positive()
  .max(10_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "Rate must be in whole cents");

/** Square footage: a single approximate number, or a range when the records give one. */
const sqftSchema = z.union([
  z.number().int().min(100).max(50_000),
  z.object({ min: z.number().int().min(100).max(50_000), max: z.number().int().min(100).max(50_000) }).refine((r) => r.max >= r.min, "Range max is below min"),
  z.null(),
]);

export const sourceRecordSchema = z.object({
  ref: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,59}$/, "Use lowercase letters, numbers and dashes"),
  name: z.string().trim().min(1).max(100),
  frequency: z.enum(IMPORT_FREQUENCIES),
  /** Per-visit amount in dollars, exactly as in the records. */
  rate: money,
  bedrooms: z.number().int().min(0).max(20).nullable().default(null),
  /** As written in the records: 2, 2.5, 3 … (".5" means one half bathroom). */
  bathrooms: z.number().min(0).max(20).nullable().default(null),
  sqft: sqftSchema.default(null),
  notes: z.string().trim().max(1000).default(""),
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;

export const sourceFileSchema = z.object({
  /** Where the records came from, e.g. "Owner's customer list, Nov 2026". Saved with each record. */
  source: z.string().trim().min(3).max(200),
  /** Must be "per_visit": the import refuses to guess what a rate covers. */
  rate_basis: z.literal("per_visit"),
  /**
   * Groups of refs the owner has confirmed are separate households even though their details are
   * identical. Stops the "possible duplicate" warning for exactly those records; any other match
   * is still flagged.
   */
  confirmed_separate: z.array(z.array(z.string().trim().min(1)).min(2)).default([]),
  customers: z.array(z.unknown()).min(1).max(500),
});

export type Outcome = "created" | "unchanged" | "conflict" | "skipped" | "error";
export type RecordReport = { ref: string; name: string; outcome: Outcome; customer_id: string | null; details: string[] };
export type ImportReport = {
  mode: "dry_run" | "apply";
  source: string;
  ran_at: string;
  totals: Record<Outcome, number>;
  records: RecordReport[];
  /** Things worth a human look even though they imported cleanly. */
  warnings: string[];
};

type Mapped = { full_baths: number | null; half_baths: number; sqft: number | null; sqftNote: string };

/** "2.5" → 2 full + 1 half. Anything other than whole or half numbers is rejected, not rounded. */
export function mapRecord(r: SourceRecord): Mapped | { error: string } {
  let full_baths: number | null = null;
  let half_baths = 0;
  if (r.bathrooms !== null) {
    const whole = Math.floor(r.bathrooms);
    const frac = Math.round((r.bathrooms - whole) * 100) / 100;
    if (frac !== 0 && frac !== 0.5) return { error: `Bathrooms "${r.bathrooms}" can't be mapped to full and half bathrooms` };
    full_baths = whole;
    half_baths = frac === 0.5 ? 1 : 0;
  }
  let sqft: number | null = null;
  let sqftNote = "";
  if (typeof r.sqft === "number") {
    sqft = r.sqft;
    sqftNote = `Approximately ${r.sqft.toLocaleString("en-US")} sq ft`;
  } else if (r.sqft) {
    // A range isn't turned into a single number: the exact figure is unknown.
    sqftNote = `Approximately ${r.sqft.min.toLocaleString("en-US")}–${r.sqft.max.toLocaleString("en-US")} sq ft`;
  }
  return { full_baths, half_baths, sqft, sqftNote };
}

const cents = (dollars: number) => Math.round(dollars * 100);
const fmt = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

class DryRunRollback extends Error {}

export async function importExistingCustomers(
  sql: Sql,
  file: unknown,
  opts: { apply: boolean; actor: { id: string | null; label: string } },
): Promise<ImportReport> {
  const parsedFile = sourceFileSchema.safeParse(file);
  const report: ImportReport = {
    mode: opts.apply ? "apply" : "dry_run",
    source: parsedFile.success ? parsedFile.data.source : "",
    ran_at: new Date().toISOString(),
    totals: { created: 0, unchanged: 0, conflict: 0, skipped: 0, error: 0 },
    records: [],
    warnings: [],
  };
  if (!parsedFile.success) {
    const msg = parsedFile.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ");
    report.records.push({ ref: "-", name: "-", outcome: "error", customer_id: null, details: [`The file isn't in the expected format: ${msg}`] });
    report.totals.error = 1;
    return report;
  }
  const { source } = parsedFile.data;

  // Validate every record first; refs must be unique within the file.
  const valid: { r: SourceRecord; m: Mapped }[] = [];
  const seenRefs = new Set<string>();
  parsedFile.data.customers.forEach((raw, i) => {
    const p = sourceRecordSchema.safeParse(raw);
    const label = (raw as { ref?: string; name?: string } | null) ?? {};
    if (!p.success) {
      report.records.push({
        ref: String(label.ref ?? `#${i + 1}`), name: String(label.name ?? "?"), outcome: "error", customer_id: null,
        details: p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`),
      });
      return;
    }
    if (seenRefs.has(p.data.ref)) {
      report.records.push({ ref: p.data.ref, name: p.data.name, outcome: "error", customer_id: null, details: ["This ref appears more than once in the file"] });
      return;
    }
    seenRefs.add(p.data.ref);
    const m = mapRecord(p.data);
    if ("error" in m) {
      report.records.push({ ref: p.data.ref, name: p.data.name, outcome: "error", customer_id: null, details: [m.error] });
      return;
    }
    valid.push({ r: p.data, m });
  });

  // Data-quality notes for a human (not errors).
  for (const { r } of valid) {
    if (r.sqft && typeof r.sqft === "object") report.warnings.push(`${r.name}: square footage is a range (${r.sqft.min}–${r.sqft.max}); saved as a note, the size field is left blank.`);
    if (r.bathrooms !== null && r.bathrooms % 1 !== 0) report.warnings.push(`${r.name}: ${r.bathrooms} bathrooms saved as ${Math.floor(r.bathrooms)} full + 1 half.`);
  }
  const sig = (r: SourceRecord) => JSON.stringify([r.frequency, r.rate, r.bedrooms, r.bathrooms, r.sqft]);
  const bySig = new Map<string, SourceRecord[]>();
  for (const { r } of valid) bySig.set(sig(r), [...(bySig.get(sig(r)) ?? []), r]);
  const confirmed = parsedFile.data.confirmed_separate.map((g) => new Set(g));
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    const names = group.map((r) => r.name).join(" and ");
    // Only silenced when one confirmed group covers every record in the match.
    if (confirmed.some((set) => group.every((r) => set.has(r.ref)))) continue;
    report.warnings.push(`${names} have identical home details, frequency and rate. Check they're separate households, not one client recorded twice.`);
  }

  try {
    await sql.begin(async (tx) => {
      // Two imports started at once run one after the other, so the second sees the first's customers.
      await tx`select pg_advisory_xact_lock(hashtext('qoc.import.existing_customers'))`;
      for (const { r, m } of valid) {
        // Each record in its own savepoint, so one failure doesn't stop the others.
        try {
          const rec = await tx.savepoint((sp) => importOne(sp, r, m, source, opts.actor));
          report.records.push(rec);
        } catch (e) {
          report.records.push({ ref: r.ref, name: r.name, outcome: "error", customer_id: null, details: [e instanceof Error ? e.message : String(e)] });
        }
      }
      for (const x of report.records) report.totals[x.outcome] += 1;
      const summary = { ...report.totals, mode: report.mode };
      if (opts.apply) {
        await tx`
          insert into audit_logs (actor_profile_id, actor_label, action, entity_type, entity_id, details)
          values (${opts.actor.id}, ${opts.actor.label}, 'import.existing_customers', 'import', null, ${tx.json({ source, ...summary } as never)})`;
        await tx`
          insert into import_batches (filename, status, summary, created_by, committed_at)
          values (${`Existing customers — ${source}`.slice(0, 200)}, 'committed', ${tx.json(summary as never)}, ${opts.actor.id}, now())`;
      } else {
        throw new DryRunRollback();
      }
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  if (!opts.apply) {
    // Everything above was rolled back; just record that a preview was run.
    await sql`
      insert into audit_logs (actor_profile_id, actor_label, action, entity_type, entity_id, details)
      values (${opts.actor.id}, ${opts.actor.label}, 'import.existing_customers.dry_run', 'import', null, ${sql.json({ source, ...report.totals } as never)})`;
  }
  report.records.sort((a, b) => a.ref.localeCompare(b.ref));
  return report;
}

async function importOne(tx: postgres.TransactionSql<Record<string, unknown>>, r: SourceRecord, m: Mapped, source: string, actor: { id: string | null; label: string }): Promise<RecordReport> {
  const priceCents = cents(r.rate);
  const [existing] = await tx<{ id: string; full_name: string; merged_into_id: string | null; preferred_frequency: string | null }[]>`
    select id, full_name, merged_into_id, preferred_frequency from customers where import_ref = ${r.ref}`;

  if (existing) {
    if (existing.merged_into_id)
      return { ref: r.ref, name: r.name, outcome: "skipped", customer_id: existing.merged_into_id, details: ["Already imported and later merged into another customer record; nothing changed."] };
    // Compare with what's there now. Anything different was changed by staff (or the source changed): keep the current value.
    const diffs: string[] = [];
    if (existing.full_name !== r.name) diffs.push(`name is "${existing.full_name}" in the system, "${r.name}" in the file`);
    const [rate] = await tx<{ price_cents: number }[]>`
      select price_cents from customer_rates where customer_id = ${existing.id} and import_ref = ${r.ref}`;
    const [active] = await tx<{ price_cents: number }[]>`
      select price_cents from customer_rates where customer_id = ${existing.id} and service_slug = 'recurring' and frequency = ${r.frequency} and status = 'active'`;
    if (!rate) diffs.push("its imported historical rate has been deleted");
    else if (rate.price_cents !== priceCents) diffs.push(`imported rate is ${fmt(rate.price_cents)}, the file says ${fmt(priceCents)}`);
    if (active && active.price_cents !== priceCents) diffs.push(`current ${r.frequency} rate is ${fmt(active.price_cents)} (changed after import)`);
    const [prop] = await tx<{ bedrooms: number | null; full_baths: number | null; half_baths: number; sqft: number | null }[]>`
      select bedrooms, full_baths, half_baths, sqft from properties where customer_id = ${existing.id} order by is_primary desc, created_at limit 1`;
    if (prop && (prop.bedrooms !== r.bedrooms || prop.full_baths !== m.full_baths || prop.half_baths !== m.half_baths || prop.sqft !== m.sqft))
      diffs.push("home details have been edited since import");
    if (existing.preferred_frequency !== r.frequency) diffs.push(`preferred frequency is ${existing.preferred_frequency ?? "blank"} in the system, ${r.frequency} in the file`);
    return diffs.length
      ? { ref: r.ref, name: r.name, outcome: "conflict", customer_id: existing.id, details: [...diffs, "Kept the values in the system; nothing was overwritten."] }
      : { ref: r.ref, name: r.name, outcome: "unchanged", customer_id: existing.id, details: ["Already imported; matches the file."] };
  }

  // Not imported yet. Refuse to guess whether a same-named customer (added another way) is this person.
  const sameName = await tx<{ id: string }[]>`
    select id from customers where lower(full_name) = lower(${r.name}) and merged_into_id is null and import_ref is null and status <> 'archived'`;
  if (sameName.length)
    return {
      ref: r.ref, name: r.name, outcome: "conflict", customer_id: sameName[0].id,
      details: [`A customer named "${r.name}" already exists (not from this import). Not imported, to avoid a duplicate. Check whether they're the same person, then add the historical rate on their profile or rename one of them.`],
    };

  const note = [`Imported from: ${source}.`, `Historical rate ${fmt(priceCents)} per visit (${r.frequency}).`, m.sqftNote ? `${m.sqftNote}.` : "", r.notes].filter(Boolean).join(" ");
  const [c] = await tx<{ id: string }[]>`
    insert into customers (full_name, status, source, import_ref, preferred_frequency, private_notes)
    values (${r.name}, 'unverified', 'import', ${r.ref}, ${r.frequency}, ${note})
    returning id`;
  // Address, city and ZIP aren't in the records, so they stay blank until confirmed with the customer.
  const [p] = await tx<{ id: string }[]>`
    insert into properties (customer_id, label, city, bedrooms, full_baths, half_baths, sqft, special_requirements, is_primary)
    values (${c.id}, 'Home', '', ${r.bedrooms}, ${m.full_baths}, ${m.half_baths}, ${m.sqft}, ${m.sqftNote ? `${m.sqftNote} (from records)` : ""}, true)
    returning id`;
  await tx`
    insert into customer_rates (customer_id, property_id, service_slug, frequency, price_cents, basis, kind, source, import_ref, notes, created_by)
    values (${c.id}, ${p.id}, 'recurring', ${r.frequency}, ${priceCents}, 'per_visit', 'historical', 'import', ${r.ref},
            ${`From ${source}`}, ${actor.id})`;
  await tx`
    insert into audit_logs (actor_profile_id, actor_label, action, entity_type, entity_id, details)
    values (${actor.id}, ${actor.label}, 'customer.imported', 'customer', ${c.id}, ${tx.json({ ref: r.ref, rate_cents: priceCents, frequency: r.frequency } as never)})`;
  return { ref: r.ref, name: r.name, outcome: "created", customer_id: c.id, details: [`Historical rate ${fmt(priceCents)} per visit (${r.frequency}). Status: ${UNVERIFIED_LABEL}.`] };
}

/** Plain-text report for the command line and for saving next to the source file. */
export function formatReport(r: ImportReport): string {
  const lines = [
    `Existing-customer import — ${r.mode === "apply" ? "APPLIED" : "DRY RUN (nothing saved)"}`,
    `Source: ${r.source || "(unreadable file)"}`,
    `Run at: ${r.ran_at}`,
    `Created ${r.totals.created} · Unchanged ${r.totals.unchanged} · Conflicts ${r.totals.conflict} · Skipped ${r.totals.skipped} · Errors ${r.totals.error}`,
    "",
  ];
  for (const x of r.records) {
    lines.push(`[${x.outcome.toUpperCase()}] ${x.ref} · ${x.name}`);
    for (const d of x.details) lines.push(`    - ${d}`);
  }
  if (r.warnings.length) {
    lines.push("", "Please check:");
    for (const w of r.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join("\n");
}
