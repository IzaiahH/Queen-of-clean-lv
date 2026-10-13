import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { db } from "@/lib/db";
import { submitBookingRequest } from "@/lib/server/booking";
import { mergeCustomers } from "@/lib/server/customers";
import { analyzeImport, commitImport } from "@/lib/server/importer";
import { publishDraft, saveDraft, startDraft } from "@/lib/server/pricing-admin";
import { getDraftPricing } from "@/lib/server/catalog";
import { OWNER, bookingRequest, resetData } from "./helpers";

/** Tiny CSV reader for the synthetic fixture (quoted fields with commas). */
function readCsv(path: string) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const split = (l: string) => [...l.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]).slice(0, -1);
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

describe("pricing versions", () => {
  beforeEach(resetData);

  it("a quote keeps its price and version after new prices are published", async () => {
    const q1 = await submitBookingRequest(bookingRequest(null));
    expect(q1.ok).toBe(true);
    const [before] = await db()<{ id: string; estimate_cents: number; pricing_version_id: string }[]>`select id, estimate_cents, pricing_version_id from quotes`;

    await startDraft(OWNER);
    const draft = (await getDraftPricing())!;
    const rules = { ...draft.rules, adjustments: [...draft.rules.adjustments, { id: "test", label: "Test increase", kind: "flat", value: 5000, services: ["*"], frequencies: [], active: true }] };
    expect((await saveDraft(OWNER, rules, "Test")).ok).toBe(true);
    expect((await publishDraft(OWNER, "Test")).ok).toBe(true);

    const [after] = await db()<{ estimate_cents: number; pricing_version_id: string }[]>`select estimate_cents, pricing_version_id from quotes where id = ${before.id}`;
    expect(after).toEqual({ estimate_cents: before.estimate_cents, pricing_version_id: before.pricing_version_id });

    await submitBookingRequest(bookingRequest(null, { email: "new@example.test", name: "New Person" }));
    const [fresh] = await db()<{ estimate_cents: number; pricing_version_id: string }[]>`select estimate_cents, pricing_version_id from quotes where id <> ${before.id}`;
    expect(fresh.pricing_version_id).not.toBe(before.pricing_version_id);
    expect(fresh.estimate_cents).toBe(before.estimate_cents + 5000);
  });
});

describe("spreadsheet import", () => {
  beforeEach(resetData);

  it("flags problems, detects duplicates, keeps unclear values as notes and imports only what was confirmed", async () => {
    await db()`insert into customers (full_name, email, status, source) values ('Alex Sample', 'alex.sample@example.com', 'active', 'admin')`;
    const { headers, rows } = readCsv("tests/fixtures/sample-tracker.csv");
    const a = await analyzeImport({ id: null, label: "Test" }, { filename: "sample-tracker.csv", headers, rows, mapping: null, batch_id: null });
    const alex = a.rows.find((r) => r.parsed.full_name === "Alex Sample")!;
    expect(alex.duplicates.length).toBeGreaterThan(0);
    expect(alex.decision).toBe("skip");
    expect(a.rows.some((r) => r.issues.length > 0)).toBe(true);

    const before = (await db()<{ n: number }[]>`select count(*)::int as n from customers`)[0].n;
    const toImport = a.rows.filter((r) => r.decision === "import");
    const res = await commitImport({ id: null, label: "Test" }, a.batch_id, a.rows);
    expect(res.ok).toBe(true);
    const after = (await db()<{ n: number }[]>`select count(*)::int as n from customers`)[0].n;
    expect(after - before).toBe(toImport.length);
    const imported = await db()<{ source: string; private_notes: string }[]>`select source, private_notes from customers where source = 'import'`;
    for (const c of imported) expect(c.private_notes).toContain("please verify");
    // Nothing is scheduled from an import.
    expect((await db()<{ n: number }[]>`select count(*)::int as n from appointments`)[0].n).toBe(0);
    // A batch can't be committed twice.
    expect((await commitImport({ id: null, label: "Test" }, a.batch_id, a.rows)).ok).toBe(false);
  });
});

describe("customer merge", () => {
  beforeEach(resetData);

  it("moves history to the kept record and archives the duplicate", async () => {
    await submitBookingRequest(bookingRequest(null, { email: "dup1@example.test", name: "Pat Example" }));
    await submitBookingRequest(bookingRequest(null, { email: "dup2@example.test", name: "Pat Example" }));
    const [keep, dupe] = await db()<{ id: string }[]>`select id from customers order by email`;
    const r = await mergeCustomers(OWNER, keep.id, dupe.id);
    expect(r.ok).toBe(true);
    const quotes = await db()<{ customer_id: string }[]>`select customer_id from quotes`;
    expect(quotes.every((q) => q.customer_id === keep.id)).toBe(true);
    const [d] = await db()<{ status: string; merged_into_id: string }[]>`select status, merged_into_id from customers where id = ${dupe.id}`;
    expect(d).toEqual({ status: "archived", merged_into_id: keep.id });
  });
});

describe("database row-level security", () => {
  it("anonymous and signed-in Supabase roles can't read customer, address, note or finance tables directly", async () => {
    await resetData();
    await db()`insert into customers (full_name, email, private_notes, status, source) values ('Secret Sample', 's@example.test', 'private', 'active', 'admin')`;
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      for (const role of ["anon", "authenticated"]) {
        for (const table of ["customers", "properties", "appointments", "quotes", "payments", "expenses", "communications", "cleaners"]) {
          // Either "permission denied" (no grant) or zero rows (RLS) is acceptable; any row is a leak.
          const rows = await sql
            .begin(async (tx) => {
              await tx.unsafe(`set local role ${role}`);
              return tx.unsafe(`select * from ${table}`);
            })
            .catch((e: { code?: string }) => (e.code === "42501" ? [] : Promise.reject(e)));
          expect(rows, `${role} reading ${table}`).toHaveLength(0);
        }
      }
    } finally {
      await sql.end();
    }
  });
});

describe("daily reminders", () => {
  it("logs each reminder once and never reports it sent without an email provider", async () => {
    await resetData();
    const [c] = await db()<{ id: string }[]>`insert into customers (full_name, email, status, source) values ('Rem Sample', 'rem@example.test', 'active', 'admin') returning id`;
    const [p] = await db()<{ id: string }[]>`insert into properties (customer_id, address_line1, city, zip, is_primary) values (${c.id}, '3 Synthetic St', 'Las Vegas', '89123', true) returning id`;
    await db()`insert into appointments (reference, customer_id, property_id, service_slug, starts_at, ends_at, status, source, agreed_price_cents, estimated_minutes, manage_token_hash)
               values ('QC-REMIND', ${c.id}, ${p.id}, 'recurring', now() + interval '20 hours', now() + interval '23 hours', 'confirmed', 'admin', 16500, 180, 'x')`;
    const { sendDueCustomerEmails } = await import("@/lib/server/appointments");
    const first = await sendDueCustomerEmails();
    expect(first.reminders).toEqual({ sent: 0, not_sent: 1 });
    const second = await sendDueCustomerEmails();
    expect(second.reminders).toEqual({ sent: 0, not_sent: 0 });
    const log = await db()<{ status: string }[]>`select status from communications where template = 'reminder'`;
    expect(log).toEqual([{ status: "skipped" }]);
  });
});
