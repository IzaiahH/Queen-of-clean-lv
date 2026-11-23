import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { importExistingCustomers } from "@/lib/import/existing-customers";
import { createManualAppointment } from "@/lib/server/appointments";
import { submitBookingRequest } from "@/lib/server/booking";
import { setCustomerRate, listCustomerRates } from "@/lib/server/customer-rates";
import { createSeries } from "@/lib/server/series";
import { OWNER, bookingRequest, makeCleaner, resetData, weekdayAt } from "./helpers";

/** Fictional records shaped like the real file (which stays out of the repository). */
const FILE = {
  source: "Test records",
  rate_basis: "per_visit",
  customers: [
    { ref: "t-01", name: "Rowan Fictional", frequency: "monthly", rate: 315, bedrooms: 3, bathrooms: 2, sqft: 1850 },
    { ref: "t-02", name: "Kit Imaginary", frequency: "biweekly", rate: 249.99, bedrooms: 3, bathrooms: 3.5, sqft: { min: 2200, max: 2400 } },
    { ref: "t-03", name: "Lee Madeup", frequency: "weekly", rate: 190, bedrooms: 2, bathrooms: 1, sqft: 950 },
  ],
};
const apply = (file: unknown = FILE) => importExistingCustomers(db(), file, { apply: true, actor: OWNER });
const preview = (file: unknown = FILE) => importExistingCustomers(db(), file, { apply: false, actor: OWNER });
const count = async (q: string) => (await db().unsafe<{ n: number }[]>(q))[0].n;

describe("existing customer import", () => {
  beforeEach(resetData);

  it("previews without saving anything", async () => {
    const r = await preview();
    expect(r.mode).toBe("dry_run");
    expect(r.totals.created).toBe(3);
    expect(await count("select count(*)::int as n from customers")).toBe(0);
    expect(await count("select count(*)::int as n from customer_rates")).toBe(0);
  });

  it("preserves historical rates to the cent and invents nothing", async () => {
    const r = await apply();
    expect(r.totals).toMatchObject({ created: 3, error: 0, conflict: 0 });
    const rows = await db()<{ ref: string; status: string; email: string | null; phone: string | null; city: string; address_line1: string | null; zip: string | null; price_cents: number; kind: string; frequency: string; full_baths: number; half_baths: number; sqft: number | null; special_requirements: string }[]>`
      select c.import_ref as ref, c.status, c.email, c.phone, p.city, p.address_line1, p.zip, r.price_cents, r.kind, r.frequency, p.full_baths, p.half_baths, p.sqft, p.special_requirements
        from customers c join properties p on p.customer_id = c.id join customer_rates r on r.customer_id = c.id order by c.import_ref`;
    expect(rows.map((x) => [x.ref, x.price_cents, x.frequency])).toEqual([["t-01", 31500, "monthly"], ["t-02", 24999, "biweekly"], ["t-03", 19000, "weekly"]]);
    for (const x of rows) {
      expect(x.status).toBe("unverified");
      expect(x.kind).toBe("historical");
      expect([x.email, x.phone, x.address_line1, x.zip]).toEqual([null, null, null, null]);
      expect(x.city).toBe("");
    }
    const kit = rows.find((x) => x.ref === "t-02")!;
    expect([kit.full_baths, kit.half_baths, kit.sqft]).toEqual([3, 1, null]);
    expect(kit.special_requirements).toContain("2,200–2,400");
    // No bookings, schedules, quotes, invoices or charges.
    for (const t of ["appointments", "recurring_series", "quotes", "payments"]) expect(await count(`select count(*)::int as n from ${t}`)).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/range/);
  });

  it("is idempotent: re-running, even concurrently, never duplicates", async () => {
    await apply();
    const again = await apply();
    expect(again.totals).toMatchObject({ created: 0, unchanged: 3, conflict: 0 });
    await Promise.all([apply(), apply(), apply()]);
    expect(await count("select count(*)::int as n from customers")).toBe(3);
    expect(await count("select count(*)::int as n from properties")).toBe(3);
    expect(await count("select count(*)::int as n from customer_rates")).toBe(3);
  });

  it("never overwrites newer information; reports it as a conflict", async () => {
    await apply();
    const [rowan] = await db()<{ id: string }[]>`select id from customers where import_ref = 't-01'`;
    await db()`update customers set full_name = 'Rowan Fictional-Smith', email = 'rowan@example.test', status = 'active' where id = ${rowan.id}`;
    await setCustomerRate(OWNER, rowan.id, { service_slug: "recurring", frequency: "monthly", price_cents: 33000 });
    await db()`update properties set sqft = 1650 where customer_id = ${rowan.id}`;

    const r = await apply();
    const rec = r.records.find((x) => x.ref === "t-01")!;
    expect(rec.outcome).toBe("conflict");
    expect(rec.details.join(" ")).toMatch(/name|rate|home details/);
    const [after] = await db()<{ full_name: string; email: string; status: string; sqft: number }[]>`
      select c.full_name, c.email, c.status, p.sqft from customers c join properties p on p.customer_id = c.id where c.id = ${rowan.id}`;
    expect(after).toEqual({ full_name: "Rowan Fictional-Smith", email: "rowan@example.test", status: "active", sqft: 1650 });
    const rates = await listCustomerRates(rowan.id);
    expect(rates.filter((x) => x.status === "active").map((x) => x.price_cents)).toEqual([33000]);
    // The original historical rate is kept in the history, not deleted or changed.
    expect(rates.find((x) => x.kind === "historical")).toMatchObject({ price_cents: 31500, status: "retired" });
  });

  it("won't guess that a same-named customer is the same person", async () => {
    await db()`insert into customers (full_name, email, status, source) values ('Lee Madeup', 'lee@example.test', 'active', 'website')`;
    const r = await apply();
    expect(r.records.find((x) => x.ref === "t-03")!.outcome).toBe("conflict");
    expect(r.totals.created).toBe(2);
    expect(await count("select count(*)::int as n from customers where lower(full_name) = 'lee madeup'")).toBe(1);
  });

  it("rejects records it can't map reliably, without blocking the good ones", async () => {
    const r = await apply({
      ...FILE,
      customers: [
        ...FILE.customers,
        { ref: "t-04", name: "Bad Baths", frequency: "monthly", rate: 250, bedrooms: 3, bathrooms: 2.25 },
        { ref: "t-05", name: "Bad Rate", frequency: "monthly", rate: 199.999 },
        { ref: "t-06", name: "Bad Frequency", frequency: "fortnightly", rate: 200 },
        { ref: "t-01", name: "Duplicate Ref", frequency: "monthly", rate: 1 },
        { ref: "t-07", name: "No Rate", frequency: "weekly" },
      ],
    });
    expect(r.totals.created).toBe(3);
    expect(r.totals.error).toBe(5);
    expect(await count("select count(*)::int as n from customers")).toBe(3);
    // A file that doesn't say what the rates cover is refused outright.
    const unclear = await apply({ ...FILE, rate_basis: "per_month" });
    expect(unclear.totals.error).toBe(1);
    expect(unclear.totals.created).toBe(0);
  });
});

describe("historical rates in pricing and booking", () => {
  beforeEach(async () => {
    await resetData();
    await makeCleaner();
  });

  it("leave website pricing and unrelated customers untouched", async () => {
    const [{ id: before }] = await db()<{ id: string }[]>`select id from pricing_versions where status = 'published'`;
    await apply();
    const [{ id: after }] = await db()<{ id: string }[]>`select id from pricing_versions where status = 'published'`;
    expect(after).toBe(before);
    // A new website customer with exactly Rowan's home gets the standard engine price, not Rowan's $315.
    const req = bookingRequest(null, { email: "new@example.test", name: "New Person" });
    Object.assign(req.property, { frequency: "monthly", bedrooms: 3, full_baths: 2, half_baths: 0, sqft: 1850 });
    const res = await submitBookingRequest(req);
    expect(res.ok).toBe(true);
    const [q] = await db()<{ breakdown: { lines: { kind: string }[] } }[]>`select breakdown from quotes`;
    expect(q.breakdown.lines.some((l) => l.kind === "base")).toBe(true);
    const [newCust] = await db()<{ id: string }[]>`select id from customers where email = 'new@example.test'`;
    expect(await listCustomerRates(newCust.id)).toEqual([]);
  });

  it("books an imported customer at their historical rate and confirms them as active", async () => {
    await apply();
    const [c] = await db()<{ id: string; property_id: string }[]>`
      select c.id, p.id as property_id from customers c join properties p on p.customer_id = c.id where c.import_ref = 't-02'`;
    const [rate] = (await listCustomerRates(c.id)).filter((r) => r.status === "active");

    // Booking needs an address first: the import never makes one up.
    const blocked = await createManualAppointment(OWNER, {
      customer_id: c.id, property_id: c.property_id, service_slug: "recurring", starts_at: weekdayAt(9, 9).toISO()!, duration_minutes: 180,
      price_cents: rate.price_cents, cleaner_ids: [], status: "confirmed", frequency: "biweekly", internal_notes: "",
    });
    expect(blocked.ok).toBe(false);

    await db()`update properties set address_line1 = '1 Fictional Ct', zip = '89123', city = 'Las Vegas' where id = ${c.property_id}`;
    const one = await createManualAppointment(OWNER, {
      customer_id: c.id, property_id: c.property_id, service_slug: "recurring", starts_at: weekdayAt(9, 9).toISO()!, duration_minutes: 180,
      price_cents: rate.price_cents, cleaner_ids: [], status: "confirmed", frequency: "biweekly", internal_notes: "", force: true,
    });
    expect(one.ok).toBe(true);
    const [appt] = await db()<{ agreed_price_cents: number }[]>`select agreed_price_cents from appointments where customer_id = ${c.id}`;
    expect(appt.agreed_price_cents).toBe(24999);
    const [{ status }] = await db()<{ status: string }[]>`select status from customers where id = ${c.id}`;
    expect(status).toBe("active");

    const series = await createSeries(OWNER, {
      customer_id: c.id, property_id: c.property_id, service_slug: "recurring", frequency: "biweekly", interval_days: null,
      anchor_date: weekdayAt(20, 9).toISODate()!, start_time: "09:00", duration_minutes: 180, price_cents: rate.price_cents, cleaner_ids: [], notes: "",
    });
    expect(series.ok).toBe(true);
    const prices = await db()<{ price: number }[]>`select distinct agreed_price_cents as price from appointments where series_id is not null`;
    expect(prices.map((p) => p.price)).toEqual([24999]);
    // The rate itself is unchanged by booking.
    expect((await listCustomerRates(c.id)).filter((r) => r.status === "active").map((r) => r.price_cents)).toEqual([24999]);
  });

  it("keeps one active rate per service and frequency, with history", async () => {
    await apply();
    const [c] = await db()<{ id: string }[]>`select id from customers where import_ref = 't-03'`;
    await setCustomerRate(OWNER, c.id, { service_slug: "recurring", frequency: "weekly", price_cents: 21000 });
    await setCustomerRate(OWNER, c.id, { service_slug: "recurring", frequency: "weekly", price_cents: 22000 });
    const rates = await listCustomerRates(c.id);
    expect(rates.filter((r) => r.status === "active").map((r) => r.price_cents)).toEqual([22000]);
    expect(rates.filter((r) => r.status === "retired").map((r) => r.price_cents).sort()).toEqual([19000, 21000]);
  });
});
