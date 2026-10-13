import { beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { db } from "@/lib/db";
import { cancelAppointment, rescheduleAppointment } from "@/lib/server/appointments";
import { createSeries, generateAllSeries, setSeriesStatus, updateSeries } from "@/lib/server/series";
import { OWNER, TZ, makeCleaner, resetData } from "./helpers";

async function customerWithHome() {
  const [c] = await db()<{ id: string }[]>`insert into customers (full_name, email, status, source) values ('Morgan Sample', 'morgan@example.test', 'active', 'admin') returning id`;
  const [p] = await db()<{ id: string }[]>`insert into properties (customer_id, address_line1, city, zip, bedrooms, full_baths, is_primary) values (${c.id}, '1 Synthetic St', 'Las Vegas', '89123', 3, 2, true) returning id`;
  return { customerId: c.id, propertyId: p.id };
}

/** Next Monday at least a week out, as a local date. */
const nextMonday = () => {
  let d = DateTime.now().setZone(TZ).plus({ days: 7 });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d.toISODate()!;
};

describe("recurring schedules", () => {
  let cleanerId: string;
  let ids: { customerId: string; propertyId: string };
  beforeEach(async () => {
    await resetData();
    cleanerId = await makeCleaner();
    ids = await customerWithHome();
  });

  const create = (over: Partial<Parameters<typeof createSeries>[1]> = {}) =>
    createSeries(OWNER, {
      customer_id: ids.customerId, property_id: ids.propertyId, service_slug: "recurring", frequency: "weekly", interval_days: null,
      anchor_date: nextMonday(), start_time: "09:00", duration_minutes: 150, price_cents: 16500, cleaner_ids: [cleanerId], ...over,
    });

  it("generates visits at the same local time and never duplicates them on re-run", async () => {
    const r = await create();
    expect(r.ok).toBe(true);
    const before = await db()<{ starts_at: Date; occurrence_date: string }[]>`select starts_at, occurrence_date from appointments order by starts_at`;
    expect(before.length).toBeGreaterThan(4);
    for (const a of before) expect(DateTime.fromJSDate(a.starts_at).setZone(TZ).toFormat("HH:mm")).toBe("09:00");
    await generateAllSeries();
    await generateAllSeries();
    const [{ n }] = await db()<{ n: number }[]>`select count(*)::int as n from appointments`;
    expect(n).toBe(before.length);
    const [{ dupes }] = await db()<{ dupes: number }[]>`select count(*)::int as dupes from (select occurrence_date from appointments group by 1 having count(*) > 1) x`;
    expect(dupes).toBe(0);
  });

  it("editing one visit leaves the series and the other visits alone", async () => {
    const r = await create();
    expect(r.ok).toBe(true);
    const visits = await db()<{ id: string; starts_at: Date }[]>`select id, starts_at from appointments order by starts_at`;
    const target = visits[1];
    const moved = await rescheduleAppointment(target.id, OWNER, { starts_at: DateTime.fromJSDate(target.starts_at).setZone(TZ).set({ hour: 13 }).toISO()!, notify: false });
    expect(moved.ok).toBe(true);
    const after = await db()<{ id: string; starts_at: Date; is_exception: boolean }[]>`select id, starts_at, is_exception from appointments order by occurrence_date`;
    expect(after.find((a) => a.id === target.id)!.is_exception).toBe(true);
    for (const a of after.filter((a) => a.id !== target.id)) expect(DateTime.fromJSDate(a.starts_at).setZone(TZ).hour).toBe(9);
    const [s] = await db()<{ start_time: string }[]>`select start_time::text from recurring_series`;
    expect(s.start_time.startsWith("09:00")).toBe(true);

    // "This and future" change keeps the edited visit as the customer agreed to it.
    const from = (await db()<{ d: string }[]>`select occurrence_date::text as d from appointments order by occurrence_date limit 1 offset 1`)[0].d;
    const u = await updateSeries(OWNER, (await db()<{ id: string }[]>`select id from recurring_series`)[0].id, from, { start_time: "10:00" });
    expect(u.ok).toBe(true);
    const kept = await db()<{ starts_at: Date }[]>`select starts_at from appointments where id = ${target.id}`;
    expect(DateTime.fromJSDate(kept[0].starts_at).setZone(TZ).hour).toBe(13);
  });

  it("skipping a visit is not undone by regeneration; pause and resume don't duplicate", async () => {
    const r = await create();
    const seriesId = (r.ok && (r.data as { id: string }).id) as string;
    const [first] = await db()<{ id: string; occurrence_date: string }[]>`select id, occurrence_date::text from appointments order by occurrence_date limit 1`;
    expect((await cancelAppointment(first.id, OWNER, "Skipped", false, true)).ok).toBe(true);
    await generateAllSeries();
    const same = await db()<{ status: string }[]>`select status from appointments where occurrence_date = ${first.occurrence_date}`;
    expect(same).toHaveLength(1);
    expect(same[0].status).toBe("cancelled");

    expect((await setSeriesStatus(OWNER, seriesId, "paused")).ok).toBe(true);
    const [{ live }] = await db()<{ live: number }[]>`select count(*)::int as live from appointments where status in ('pending','confirmed')`;
    expect(live).toBe(0);
    expect((await setSeriesStatus(OWNER, seriesId, "active")).ok).toBe(true);
    const [{ dupes }] = await db()<{ dupes: number }[]>`select count(*)::int as dupes from (select occurrence_date from appointments group by 1 having count(*) > 1) x`;
    expect(dupes).toBe(0);
  });

  it("flags conflicts instead of double-booking the cleaner", async () => {
    expect((await create()).ok).toBe(true);
    const other = await db()<{ id: string }[]>`insert into customers (full_name, status, source) values ('Second Sample', 'active', 'admin') returning id`;
    const [p] = await db()<{ id: string }[]>`insert into properties (customer_id, address_line1, city, zip, is_primary) values (${other[0].id}, '2 Synthetic St', 'Las Vegas', '89123', true) returning id`;
    const r = await createSeries(OWNER, {
      customer_id: other[0].id, property_id: p.id, service_slug: "recurring", frequency: "biweekly", interval_days: null,
      anchor_date: nextMonday(), start_time: "10:00", duration_minutes: 120, price_cents: 18500, cleaner_ids: [cleanerId],
    });
    expect(r.ok).toBe(true);
    const flagged = await db()<{ n: number }[]>`select count(*)::int as n from appointments where needs_attention like 'Recurring visit conflict%'`;
    expect(flagged[0].n).toBeGreaterThan(0);
    const overlaps = await db()<{ n: number }[]>`
      select count(*)::int as n from appointment_assignments x join appointment_assignments y
        on x.cleaner_id = y.cleaner_id and x.id < y.id and x.active and y.active and x.during && y.during`;
    expect(overlaps[0].n).toBe(0);
  });

  it("monthly visits anchored on the 31st land on each month's last day", async () => {
    let d = DateTime.now().setZone(TZ).plus({ months: 1 }).endOf("month");
    while (d.day !== 31) d = d.plus({ months: 1 }).endOf("month");
    await db()`insert into settings (key, value) values ('recurring', '{"horizon_weeks": 26}') on conflict (key) do update set value = excluded.value`;
    const r = await create({ frequency: "monthly", anchor_date: d.toISODate()!, cleaner_ids: [] });
    expect(r.ok).toBe(true);
    await updateSeries(OWNER, (r.ok && (r.data as { id: string }).id) as string, null, {}); // no-op edit keeps dates stable
    const dates = await db()<{ d: string }[]>`select occurrence_date::text as d from appointments order by occurrence_date`;
    expect(dates.length).toBeGreaterThan(1);
    for (const { d: x } of dates) expect(DateTime.fromISO(x).day).toBe(DateTime.fromISO(x).endOf("month").day);
  });
});
