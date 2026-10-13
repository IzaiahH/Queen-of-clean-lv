import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { bookingRequestSchema, type BookingRequest } from "@/lib/validation/booking";

export const TZ = "America/Los_Angeles";
export const OWNER = { id: null, label: "Test owner" };

/** Clears every business table between tests; keeps the seeded catalog, pricing and settings. */
export async function resetData() {
  // Plain deletes (not TRUNCATE ... CASCADE, which would also wipe profiles and pricing via their FKs).
  await db().begin(async (tx) => {
    for (const t of ["communications", "payments", "expenses", "audit_logs", "import_batches", "contact_messages", "rate_limits",
      "appointments", "recurring_series", "quotes", "customers", "sessions", "profiles", "cleaners", "settings"]) await tx.unsafe(`delete from ${t}`);
  });
}

/** The next weekday after `d`, same local time. */
export function nextWeekday(d: DateTime) {
  let n = d.plus({ days: 1 });
  while (n.weekday > 5) n = n.plus({ days: 1 });
  return n;
}

/** A weekday at the given local time, at least `daysAhead` days out. */
export function weekdayAt(daysAhead: number, hour: number, minute = 0) {
  let d = DateTime.now().setZone(TZ).plus({ days: daysAhead }).set({ hour, minute, second: 0, millisecond: 0 });
  while (d.weekday > 5) d = d.plus({ days: 1 });
  return d;
}

export async function makeCleaner(name = "Test Cleaner A") {
  const [c] = await db()<{ id: string }[]>`
    insert into cleaners (full_name, email, color, worker_type, pay_method, pay_rate_cents, max_jobs_per_day)
    values (${name}, ${`${name.toLowerCase().replace(/\W+/g, ".")}@example.test`}, '#8E6B2E', 'unspecified', 'hourly', 2200, 4) returning id`;
  for (const wd of [1, 2, 3, 4, 5]) await db()`insert into cleaner_working_hours (cleaner_id, weekday, start_time, end_time) values (${c.id}, ${wd}, '07:00', '18:00')`;
  return c.id;
}

/** Built the way the public API builds it: through the real request schema. */
export function bookingRequest(start: DateTime | null, over: { email?: string; name?: string; key?: string } = {}): BookingRequest {
  return bookingRequestSchema.parse({
    idempotency_key: over.key ?? randomUUID(),
    mode: start ? "book" : "quote_only",
    property: {
      service: "recurring", frequency: "biweekly", property_type: "house", bedrooms: 3, full_baths: 2, half_baths: 0, sqft: 1800,
      condition: "standard", pets: 0, addons: [], zip: "89123", address_line1: "100 Example Way", unit: "", city: "Las Vegas",
      recently_cleaned: "yes", pet_details: "", occupancy: "", special_requests: "",
    },
    schedule: { slot_start: start ? start.toISO() : null, preferred_window: "flexible", preferences: "", wants_recurring: false },
    contact: {
      full_name: over.name ?? "Jordan Testperson", email: over.email ?? "jordan@example.test", phone: "702-555-0199", preferred_contact: "email",
      access_instructions: "Code 0000 (synthetic)", notes: "", consent: true,
    },
    website: "",
    started_at: Date.now() - 60_000,
  });
}
