/**
 * Synthetic demo data for local development and screenshots ONLY. Every name, address and email
 * is invented (example.com). Never run against production.
 *   npm run db:seed:demo
 */
import postgres from "postgres";
import { DateTime } from "luxon";
import { randomBytes, createHash } from "node:crypto";
import { loadEnv } from "./env";

loadEnv();
const TZ = "America/Los_Angeles";
const ref = () => `QC-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) throw new Error("Refusing to seed demo data in production.");
  const sql = postgres(process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL!, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [has] = await sql`select 1 from cleaners where email like '%@example.com' limit 1`;
    if (has) {
      console.log("Demo data already present.");
      return;
    }
    const cleaners = await sql<{ id: string; full_name: string }[]>`
      insert into cleaners (full_name, email, phone, color, worker_type, pay_method, pay_rate_cents, max_jobs_per_day) values
        ('Sample Cleaner A', 'cleaner.a@example.com', '702-555-0101', '#8E6B2E', 'unspecified', 'hourly', 2200, 3),
        ('Sample Cleaner B', 'cleaner.b@example.com', '702-555-0102', '#2F5D62', 'unspecified', 'per_job', 9000, 3)
      returning id, full_name`;
    for (const c of cleaners) {
      for (const wd of [1, 2, 3, 4, 5]) {
        await sql`insert into cleaner_working_hours (cleaner_id, weekday, start_time, end_time) values (${c.id}, ${wd}, '08:00', '17:00')`;
      }
    }
    const [summerlin] = await sql<{ id: string }[]>`select id from service_areas where name = 'Summerlin'`;
    const [henderson] = await sql<{ id: string }[]>`select id from service_areas where name = 'Henderson'`;
    const people = [
      { name: "Jordan Ellis (sample)", email: "jordan.sample@example.com", phone: "702-555-0141", addr: "100 Sample Ridge Dr", zip: "89135", area: summerlin?.id, beds: 3, baths: 2, sqft: 1900 },
      { name: "Priya Shah (sample)", email: "priya.sample@example.com", phone: "702-555-0142", addr: "200 Example Canyon Ave", zip: "89052", area: henderson?.id, beds: 4, baths: 3, sqft: 2600 },
      { name: "Marcus Lee (sample)", email: "marcus.sample@example.com", phone: "702-555-0143", addr: "300 Demo Vista Ln", zip: "89144", area: summerlin?.id, beds: 2, baths: 2, sqft: 1300 },
    ];
    const created: { customer: string; property: string }[] = [];
    for (const p of people) {
      const [c] = await sql<{ id: string }[]>`
        insert into customers (full_name, email, phone, status, customer_since, source, booking_comms_consent)
        values (${p.name}, ${p.email}, ${p.phone}, 'active', current_date - 200, 'admin', true) returning id`;
      const [pr] = await sql<{ id: string }[]>`
        insert into properties (customer_id, address_line1, city, zip, service_area_id, bedrooms, full_baths, sqft, condition, access_instructions)
        values (${c.id}, ${p.addr}, 'Las Vegas', ${p.zip}, ${p.area ?? null}, ${p.beds}, ${p.baths}, ${p.sqft}, 'standard', 'Sample: lockbox code shared by phone')
        returning id`;
      created.push({ customer: c.id, property: pr.id });
    }
    const today = DateTime.now().setZone(TZ).startOf("day");
    const nextWeekday = (d: DateTime) => (d.weekday > 5 ? d.plus({ days: 8 - d.weekday }) : d);
    // Two completed jobs last week with job records and labor.
    for (let i = 0; i < 2; i++) {
      const day = nextWeekday(today.minus({ days: 7 - i }));
      const start = day.set({ hour: 9 + i * 4 });
      const [a] = await sql<{ id: string }[]>`
        insert into appointments (reference, customer_id, property_id, service_slug, starts_at, ends_at, status, source, frequency,
                                  agreed_price_cents, estimated_minutes, actual_minutes, manage_token_hash)
        values (${ref()}, ${created[i].customer}, ${created[i].property}, 'recurring', ${start.toJSDate()}, ${start.plus({ hours: 3 }).toJSDate()},
                'completed', 'admin', 'biweekly', ${18500 + i * 2500}, 180, ${170 + i * 20}, ${tokenHash()})
        returning id`;
      await sql`insert into appointment_assignments (appointment_id, cleaner_id) values (${a.id}, ${cleaners[i].id})`;
      await sql`insert into job_records (appointment_id, revenue_cents, supplies_cents) values (${a.id}, ${18500 + i * 2500}, 900)`;
      const pay = i === 0 ? Math.round((2200 * 170) / 60) : 9000;
      await sql`insert into labor_records (appointment_id, cleaner_id, minutes, pay_cents, pay_basis)
                values (${a.id}, ${cleaners[i].id}, ${170 + i * 20}, ${pay}, ${i === 0 ? "hourly $22.00 × 2.83 h" : "flat $90.00 per job"})`;
    }
    // One pending website request and one confirmed job this week.
    const d1 = nextWeekday(today.plus({ days: 3 })).set({ hour: 9 });
    const [pending] = await sql<{ id: string }[]>`
      insert into appointments (reference, customer_id, property_id, service_slug, starts_at, ends_at, status, source, frequency, agreed_price_cents, estimated_minutes, manage_token_hash)
      values (${ref()}, ${created[2].customer}, ${created[2].property}, 'deep', ${d1.toJSDate()}, ${d1.plus({ hours: 4 }).toJSDate()}, 'pending', 'website', 'one_time', 27500, 240, ${tokenHash()})
      returning id`;
    await sql`insert into appointment_assignments (appointment_id, cleaner_id) values (${pending.id}, ${cleaners[0].id})`;
    const d2 = nextWeekday(today.plus({ days: 2 })).set({ hour: 13 });
    const [conf] = await sql<{ id: string }[]>`
      insert into appointments (reference, customer_id, property_id, service_slug, starts_at, ends_at, status, source, frequency, agreed_price_cents, estimated_minutes, manage_token_hash)
      values (${ref()}, ${created[1].customer}, ${created[1].property}, 'standard', ${d2.toJSDate()}, ${d2.plus({ hours: 3 }).toJSDate()}, 'confirmed', 'admin', 'one_time', 26000, 180, ${tokenHash()})
      returning id`;
    await sql`insert into appointment_assignments (appointment_id, cleaner_id) values (${conf.id}, ${cleaners[1].id})`;
    await sql`insert into expenses (spent_on, category, amount_cents, description) values (current_date - 3, 'supplies', 4800, 'Sample: microfiber cloths and cleaner refills')`;
    console.log("Synthetic demo data created (2 cleaners, 3 sample customers, 4 appointments). Create a recurring schedule from Admin to see series generation.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
