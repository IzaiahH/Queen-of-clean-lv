import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { IMPORT_FIELDS, guessMapping, reviewRows, summarize, type ImportField, type ReviewRow } from "@/lib/import/review";
import { audit, type Actor } from "./audit";
import { DateTime } from "luxon";
import { loadSettings } from "./settings";

export const MAX_IMPORT_ROWS = 2000;
const fieldEnum = z.enum(Object.keys(IMPORT_FIELDS) as [ImportField, ...ImportField[]]);

export const analyzeSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  headers: z.array(z.string().max(200)).min(1).max(60),
  rows: z.array(z.array(z.string().max(5000)).max(60)).max(MAX_IMPORT_ROWS),
  mapping: z.array(fieldEnum).nullable(),
  batch_id: z.string().uuid().nullable(),
});

/** Runs the review against current customers and stores the batch so the review can be resumed. */
export async function analyzeImport(actor: Actor, input: z.input<typeof analyzeSchema>) {
  const d = analyzeSchema.parse(input);
  const mapping = d.mapping && d.mapping.length === d.headers.length ? d.mapping : guessMapping(d.headers);
  const nonEmpty = d.rows.filter((r) => r.some((c) => c.trim()));
  const [areas, existing, settings] = await Promise.all([
    db()<{ name: string }[]>`select name from service_areas`,
    db()<{ id: string; full_name: string; email: string | null; phone: string | null }[]>`select id, full_name, email, phone from customers where merged_into_id is null`,
    loadSettings(),
  ]);
  const reviewed = reviewRows(d.headers, nonEmpty, mapping, {
    areas: areas.map((a) => a.name),
    existing: Array.from(existing),
    today: DateTime.now().setZone(settings.booking.timezone),
  });
  const summary = summarize(reviewed);
  let batchId = d.batch_id;
  if (batchId) {
    await db()`update import_batches set mapping = ${db().json(mapping as never)}, rows = ${db().json(reviewed as never)}, summary = ${db().json(summary as never)} where id = ${batchId} and status = 'review'`;
  } else {
    const [row] = await db()<{ id: string }[]>`
      insert into import_batches (filename, status, mapping, rows, summary, created_by) values (${d.filename}, 'review', ${db().json(mapping as never)}, ${db().json(reviewed as never)}, ${db().json(summary as never)}, ${actor.id}) returning id`;
    batchId = row.id;
    await audit(actor, "import.analyze", "import_batch", batchId, { filename: d.filename, rows: nonEmpty.length });
  }
  return { batch_id: batchId, mapping, rows: reviewed, summary };
}

const nz = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
export const commitRowSchema = z.object({
  index: z.number().int().min(1),
  decision: z.enum(["import", "skip"]),
  parsed: z.object({
    full_name: z.string().trim().min(1, "Name is required").max(120),
    email: z.string().trim().toLowerCase().email().nullable().or(z.literal("").transform(() => null)),
    phone: z.string().trim().max(40).nullable().transform(nz),
    area_name: z.string().max(80).nullable(),
    address_line1: z.string().trim().max(200).nullable().transform(nz),
    zip: z.string().trim().regex(/^\d{5}$/).nullable().or(z.literal("").transform(() => null)),
    bedrooms: z.number().int().min(0).max(20).nullable(),
    full_baths: z.number().int().min(0).max(20).nullable(),
    half_baths: z.number().int().min(0).max(20),
    sqft: z.number().int().min(100).max(50000).nullable(),
    frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "one_time"]).nullable(),
    agreed_price_cents: z.number().int().min(0).max(1_000_000).nullable(),
    estimated_minutes: z.number().int().min(0).max(1440).nullable(),
    next_cleaning: z.string().nullable(),
    notes: z.array(z.string().max(2000)).max(80),
  }),
});

const FREQ_TEXT: Record<string, string> = { weekly: "weekly", biweekly: "every 2 weeks", monthly: "monthly", quarterly: "quarterly", one_time: "one-time" };

/**
 * Creates customer + property records for rows marked "import". Imported values are stored as
 * what the spreadsheet said (noted as imported), never auto-scheduled, never published anywhere.
 */
export async function commitImport(actor: Actor, batchId: string, rawRows: unknown[]) {
  if (!Array.isArray(rawRows) || rawRows.length > MAX_IMPORT_ROWS) return { ok: false as const, error: "Too many rows." };
  const rows: z.output<typeof commitRowSchema>[] = [];
  const problems: string[] = [];
  for (const raw of rawRows) {
    const r = commitRowSchema.safeParse(raw);
    if (r.success) rows.push(r.data);
    else if ((raw as { decision?: string })?.decision === "import")
      problems.push(`Row ${(raw as { index?: number })?.index ?? "?"}: ${r.error.issues.map((i) => `${String(i.path.at(-1))} ${i.message.toLowerCase()}`).join(", ")}`);
  }
  if (problems.length) return { ok: false as const, error: `Fix these rows or skip them: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ""}` };
  return db().begin(async (tx) => {
    const [batch] = await tx<{ filename: string; status: string }[]>`select filename, status from import_batches where id = ${batchId} for update`;
    if (!batch) return { ok: false as const, error: "Import not found." };
    if (batch.status !== "review") return { ok: false as const, error: "This import was already completed or discarded." };
    const areas = await tx<{ id: string; name: string; zip_codes: string[] }[]>`select id, name, zip_codes from service_areas`;
    let created = 0;
    for (const r of rows) {
      if (r.decision !== "import") continue;
      const p = r.parsed;
      const area = areas.find((a) => a.name === p.area_name) ?? (p.zip ? areas.find((a) => a.zip_codes.includes(p.zip!)) : undefined);
      const lines = [
        `Imported from "${batch.filename}" (row ${r.index}) on ${new Date().toISOString().slice(0, 10)}. Values are as recorded in the spreadsheet; please verify.`,
        p.agreed_price_cents !== null ? `Price per visit (spreadsheet): $${(p.agreed_price_cents / 100).toFixed(2)}${p.frequency ? `, ${FREQ_TEXT[p.frequency]}` : ""}` : p.frequency ? `Frequency (spreadsheet): ${FREQ_TEXT[p.frequency]}` : null,
        p.estimated_minutes ? `Typical cleaning time (spreadsheet): ${(p.estimated_minutes / 60).toFixed(1)} h` : null,
        ...p.notes,
      ].filter(Boolean);
      const [c] = await tx<{ id: string }[]>`
        insert into customers (full_name, email, phone, status, source, private_notes, customer_since)
        values (${p.full_name}, ${p.email}, ${p.phone}, 'active', 'import', ${lines.join("\n")}, null) returning id`;
      await tx`
        insert into properties (customer_id, label, address_line1, city, zip, service_area_id, bedrooms, full_baths, half_baths, sqft, is_primary)
        values (${c.id}, 'Home', ${p.address_line1}, ${area && ["Henderson", "North Las Vegas"].includes(area.name) ? area.name : "Las Vegas"}, ${p.zip}, ${area?.id ?? null},
                ${p.bedrooms}, ${p.full_baths}, ${p.half_baths}, ${p.sqft}, true)`;
      created++;
    }
    const summary = { created, skipped: rows.length - created };
    await tx`update import_batches set status = 'committed', committed_at = now(), summary = summary || ${tx.json(summary as never)} where id = ${batchId}`;
    await audit(actor, "import.commit", "import_batch", batchId, summary, tx);
    return { ok: true as const, ...summary };
  });
}

export async function discardImport(actor: Actor, batchId: string) {
  await db()`update import_batches set status = 'discarded', rows = '[]' where id = ${batchId} and status = 'review'`;
  await audit(actor, "import.discard", "import_batch", batchId);
}

export async function recentImports() {
  const rows = await db()<{ id: string; filename: string; status: string; summary: Record<string, number>; created_at: Date; committed_at: Date | null }[]>`
    select id, filename, status, summary, created_at, committed_at from import_batches order by created_at desc limit 10`;
  return Array.from(rows).map((r) => ({ ...r }));
}

export type { ReviewRow };
