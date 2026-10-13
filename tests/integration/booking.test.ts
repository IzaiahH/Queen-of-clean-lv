import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { submitBookingRequest } from "@/lib/server/booking";
import { cancelAppointment, confirmAppointment, rescheduleAppointment } from "@/lib/server/appointments";
import { OWNER, bookingRequest, makeCleaner, nextWeekday, resetData, weekdayAt } from "./helpers";

describe("public booking", () => {
  beforeEach(async () => {
    await resetData();
    await makeCleaner();
  });

  it("creates customer, property, quote, appointment and assignment, and logs the email honestly", async () => {
    const r = await submitBookingRequest(bookingRequest(weekdayAt(8, 10)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("appointment");
    const [a] = await db()<{ id: string; status: string; customer_id: string; quote_id: string; agreed_price_cents: number }[]>`select id, status, customer_id, quote_id, agreed_price_cents from appointments`;
    expect(["pending", "confirmed"]).toContain(a.status);
    expect(a.agreed_price_cents).toBeGreaterThan(0);
    const [{ n: props }] = await db()<{ n: number }[]>`select count(*)::int as n from properties where customer_id = ${a.customer_id}`;
    expect(props).toBe(1);
    const [{ n: assigned }] = await db()<{ n: number }[]>`select count(*)::int as n from appointment_assignments where appointment_id = ${a.id}`;
    expect(assigned).toBe(1);
    // No email provider in tests: the log must say "skipped", never "sent".
    expect(r.email).toBe("skipped");
    const comms = await db()<{ status: string }[]>`select status from communications where appointment_id = ${a.id}`;
    expect(comms.length).toBeGreaterThan(0);
    expect(comms.every((c) => c.status !== "sent")).toBe(true);
  });

  it("returns the original result for a duplicate submission instead of booking twice", async () => {
    const req = bookingRequest(weekdayAt(8, 10));
    const first = await submitBookingRequest(req);
    const second = await submitBookingRequest(req);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.reference).toBe(first.reference);
    const [{ n }] = await db()<{ n: number }[]>`select count(*)::int as n from appointments`;
    expect(n).toBe(1);
  });

  it("blocks concurrent double booking of the only cleaner", async () => {
    const start = weekdayAt(8, 10);
    const results = await Promise.all([
      submitBookingRequest(bookingRequest(start, { email: "a@example.test", name: "Avery Example" })),
      submitBookingRequest(bookingRequest(start, { email: "b@example.test", name: "Blake Example" })),
      submitBookingRequest(bookingRequest(start.plus({ minutes: 30 }), { email: "c@example.test", name: "Cam Example" })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.slot_taken)).toHaveLength(2);
    const [{ n }] = await db()<{ n: number }[]>`select count(*)::int as n from appointments`;
    expect(n).toBe(1);
  });

  it("matches an existing customer by email without overwriting their record", async () => {
    await submitBookingRequest(bookingRequest(weekdayAt(8, 9)));
    await submitBookingRequest(bookingRequest(weekdayAt(9, 13), { name: "Somebody Else", email: "JORDAN@example.test" }));
    const customers = await db()<{ full_name: string }[]>`select full_name from customers`;
    expect(customers).toHaveLength(1);
    expect(customers[0].full_name).toBe("Jordan Testperson");
    const [{ n }] = await db()<{ n: number }[]>`select count(*)::int as n from appointments`;
    expect(n).toBe(2);
  });

  it("frees the slot when an appointment is cancelled", async () => {
    const start = weekdayAt(8, 10);
    const first = await submitBookingRequest(bookingRequest(start));
    expect(first.ok).toBe(true);
    const blocked = await submitBookingRequest(bookingRequest(start, { email: "other@example.test", name: "Other Person" }));
    expect(blocked.ok).toBe(false);
    const [a] = await db()<{ id: string }[]>`select id from appointments`;
    const c = await cancelAppointment(a.id, OWNER, "Customer asked", false);
    expect(c.ok).toBe(true);
    const again = await submitBookingRequest(bookingRequest(start, { email: "other@example.test", name: "Other Person" }));
    expect(again.ok).toBe(true);
  });

  it("refuses an admin reschedule onto a booked cleaner unless forced, and never double-books", async () => {
    const d1 = weekdayAt(8, 9);
    const r1 = await submitBookingRequest(bookingRequest(d1));
    const r2 = await submitBookingRequest(bookingRequest(nextWeekday(d1), { email: "x@example.test", name: "Xan Example" }));
    expect([r1, r2].map((r) => (r.ok ? "ok" : r.error))).toEqual(["ok", "ok"]);
    const rows = await db()<{ id: string; starts_at: Date }[]>`select id, starts_at from appointments order by starts_at`;
    for (const r of rows) await confirmAppointment(r.id, OWNER, false);
    const moved = await rescheduleAppointment(rows[1].id, OWNER, { starts_at: rows[0].starts_at.toISOString(), notify: false });
    expect(moved.ok).toBe(false);
    const forced = await rescheduleAppointment(rows[1].id, OWNER, { starts_at: rows[0].starts_at.toISOString(), notify: false, force: true });
    // Even when forced, the database constraint keeps the cleaner from holding two overlapping jobs.
    const overlaps = await db()<{ n: number }[]>`
      select count(*)::int as n from appointment_assignments x join appointment_assignments y
        on x.cleaner_id = y.cleaner_id and x.id < y.id and x.active and y.active and x.during && y.during`;
    expect(overlaps[0].n).toBe(0);
    expect(typeof forced.ok).toBe("boolean");
  });
});
