import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { nthOccurrence, occurrencesBetween, occurrenceWindow } from "@/lib/scheduling/recurrence";

describe("recurrence", () => {
  it("weekly and biweekly step by 7 and 14 days", () => {
    expect(occurrencesBetween({ frequency: "weekly", anchor_date: "2026-11-02" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(occurrencesBetween({ frequency: "biweekly", anchor_date: "2026-11-02" }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-02", "2026-11-16", "2026-11-30"]);
  });

  it("monthly on the 31st clamps to month end without drifting", () => {
    const r = { frequency: "monthly" as const, anchor_date: "2027-01-31" };
    expect([0, 1, 2, 3].map((n) => nthOccurrence(r, n))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(nthOccurrence({ frequency: "monthly", anchor_date: "2028-01-31" }, 1)).toBe("2028-02-29"); // leap year
  });

  it("quarterly and custom intervals", () => {
    expect(nthOccurrence({ frequency: "quarterly", anchor_date: "2026-11-30" }, 1)).toBe("2027-02-28");
    expect(nthOccurrence({ frequency: "quarterly", anchor_date: "2026-11-30" }, 2)).toBe("2027-05-30");
    expect(occurrencesBetween({ frequency: "custom", interval_days: 10, anchor_date: "2026-11-01" }, "2026-11-01", "2026-11-25")).toEqual(["2026-11-01", "2026-11-11", "2026-11-21"]);
  });

  it("respects the series end date and the window start", () => {
    expect(occurrencesBetween({ frequency: "weekly", anchor_date: "2026-11-02", ends_on: "2026-11-16" }, "2026-11-05", "2026-12-31")).toEqual(["2026-11-09", "2026-11-16"]);
  });

  it("keeps the same local start time across the DST change (Nov 1, 2026 in Las Vegas)", () => {
    const tz = "America/Los_Angeles";
    const before = occurrenceWindow("2026-10-26", "09:00", 120, tz);
    const after = occurrenceWindow("2026-11-02", "09:00", 120, tz);
    expect(DateTime.fromISO(before.starts_at).setZone(tz).toFormat("HH:mm")).toBe("09:00");
    expect(DateTime.fromISO(after.starts_at).setZone(tz).toFormat("HH:mm")).toBe("09:00");
    expect(before.starts_at).toBe("2026-10-26T16:00:00.000Z"); // PDT, UTC−7
    expect(after.starts_at).toBe("2026-11-02T17:00:00.000Z"); // PST, UTC−8
  });
});
