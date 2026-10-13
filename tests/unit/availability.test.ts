import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { checkSlot, listSlots, type ScheduleContext } from "@/lib/scheduling/availability";

const tz = "America/Los_Angeles";
const at = (s: string) => DateTime.fromISO(s, { zone: tz });
const weekday = { open: "08:00", close: "17:00" };
const hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" }));

function ctx(over: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    config: {
      tz,
      operating_hours: { "1": weekday, "2": weekday, "3": weekday, "4": weekday, "5": weekday, "6": null, "7": null },
      slot_interval_minutes: 60,
      lead_time_hours: 24,
      travel_buffer_minutes: 30,
      max_jobs_per_day: 4,
      horizon_days: 60,
    },
    cleaners: [{ id: "c1", name: "A", capabilities: [], max_jobs_per_day: null, hours, time_off: [] }],
    busy: [],
    blocked: [],
    ...over,
  };
}
const now = at("2026-11-01T12:00"); // Sunday

describe("availability", () => {
  it("lists real start times inside business and cleaner hours, honoring lead time and closed days", () => {
    const days = listSlots(ctx(), "2026-11-01", 3, 180, { now });
    expect(days[0].slots).toEqual([]); // Sunday: closed
    expect(days[1].slots.map((s) => s.label)).toEqual(["12:00 PM", "1:00 PM", "2:00 PM"]); // Monday: 24h lead time from Sunday noon
    expect(days[2].slots.map((s) => s.label)).toEqual(["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM"]);
  });

  it("confirmed appointments block their time plus the travel buffer", () => {
    const c = ctx({ busy: [{ id: "a1", starts_at: at("2026-11-03T10:00").toISO()!, ends_at: at("2026-11-03T12:00").toISO()!, cleaner_ids: ["c1"] }] });
    const labels = listSlots(c, "2026-11-03", 1, 120, { now })[0].slots.map((s) => s.label);
    // 8:00–10:00 ends at 10:00 but needs a 30-min buffer → blocked; 12:00 start is within buffer → blocked.
    expect(labels).toEqual(["1:00 PM", "2:00 PM", "3:00 PM"]);
  });

  it("a second cleaner adds capacity; unassigned requests still consume capacity", () => {
    const two = ctx({
      cleaners: [
        { id: "c1", name: "A", capabilities: [], max_jobs_per_day: null, hours, time_off: [] },
        { id: "c2", name: "B", capabilities: [], max_jobs_per_day: null, hours, time_off: [] },
      ],
      busy: [{ id: "a1", starts_at: at("2026-11-03T09:00").toISO()!, ends_at: at("2026-11-03T12:00").toISO()!, cleaner_ids: ["c1"] }],
    });
    const r = checkSlot(two, at("2026-11-03T09:00"), at("2026-11-03T12:00"), { now });
    expect(r.ok).toBe(true);
    expect(r.cleaner_ids).toEqual(["c2"]);
    two.busy.push({ id: "a2", starts_at: at("2026-11-03T09:00").toISO()!, ends_at: at("2026-11-03T12:00").toISO()!, cleaner_ids: [] });
    expect(checkSlot(two, at("2026-11-03T09:00"), at("2026-11-03T12:00"), { now }).ok).toBe(false);
  });

  it("cancelled appointments are simply absent from busy, so they don't block", () => {
    expect(checkSlot(ctx(), at("2026-11-03T09:00"), at("2026-11-03T12:00"), { now }).ok).toBe(true);
  });

  it("respects time off, blocked periods, capabilities and daily limits", () => {
    const off = ctx({ cleaners: [{ id: "c1", name: "A", capabilities: [], max_jobs_per_day: null, hours, time_off: [{ starts_at: at("2026-11-03T00:00").toISO()!, ends_at: at("2026-11-04T00:00").toISO()! }] }] });
    expect(checkSlot(off, at("2026-11-03T09:00"), at("2026-11-03T11:00")).problems.join()).toMatch(/available/);
    const blocked = ctx({ blocked: [{ starts_at: at("2026-11-03T08:00").toISO()!, ends_at: at("2026-11-03T13:00").toISO()!, reason: "Holiday" }] });
    expect(checkSlot(blocked, at("2026-11-03T09:00"), at("2026-11-03T11:00")).problems.join()).toMatch(/Holiday/);
    const cap = ctx({ cleaners: [{ id: "c1", name: "A", capabilities: ["recurring"], max_jobs_per_day: null, hours, time_off: [] }] });
    expect(checkSlot(cap, at("2026-11-03T09:00"), at("2026-11-03T11:00"), { serviceSlug: "move" }).ok).toBe(false);
    const limit = ctx();
    limit.config.max_jobs_per_day = 1;
    limit.busy.push({ id: "x", starts_at: at("2026-11-03T08:00").toISO()!, ends_at: at("2026-11-03T09:00").toISO()!, cleaner_ids: [] });
    expect(checkSlot(limit, at("2026-11-03T14:00"), at("2026-11-03T15:00")).problems.join()).toMatch(/daily job limit/);
  });

  it("excluding the appointment being moved lets it shift within its own time", () => {
    const c = ctx({ busy: [{ id: "a1", starts_at: at("2026-11-03T10:00").toISO()!, ends_at: at("2026-11-03T12:00").toISO()!, cleaner_ids: ["c1"] }] });
    expect(checkSlot(c, at("2026-11-03T11:00"), at("2026-11-03T13:00")).ok).toBe(false);
    expect(checkSlot(c, at("2026-11-03T11:00"), at("2026-11-03T13:00"), { excludeAppointmentId: "a1" }).ok).toBe(true);
  });

  it("no cleaners means no availability", () => {
    expect(listSlots(ctx({ cleaners: [] }), "2026-11-03", 1, 60, { now })[0].slots).toEqual([]);
  });
});
