import { describe, expect, it } from "vitest";
import { ADMIN_NAV, can } from "@/lib/auth/permissions";

describe("permissions", () => {
  it("unauthenticated users can do nothing", () => {
    expect(can(null, "dashboard.view")).toBe(false);
    expect(can(undefined, "customers.view")).toBe(false);
  });
  it("cleaners cannot see customers, finance, pay or settings", () => {
    for (const cap of ["customers.view", "finance.view", "cleaners.pay", "settings.edit", "reports.view", "schedule.view"] as const) expect(can("cleaner", cap)).toBe(false);
    expect(can("cleaner", "jobs.own")).toBe(true);
  });
  it("office staff schedule and manage customers but not money or pricing", () => {
    expect(can("office", "schedule.edit")).toBe(true);
    expect(can("office", "customers.edit")).toBe(true);
    expect(can("office", "finance.view")).toBe(false);
    expect(can("office", "cleaners.pay")).toBe(false);
    expect(can("office", "pricing.edit")).toBe(false);
  });
  it("customer-specific rates: owner and admin change them, office staff only see them, cleaners neither", () => {
    expect(can("owner", "customers.rates")).toBe(true);
    expect(can("admin", "customers.rates")).toBe(true);
    expect(can("office", "customers.rates")).toBe(false);
    expect(can("office", "customers.view")).toBe(true); // sees rates on profiles and when booking
    expect(can("cleaner", "customers.rates")).toBe(false);
    expect(can("cleaner", "customers.view")).toBe(false);
  });
  it("only the owner manages staff accounts", () => {
    expect(can("owner", "users.manage")).toBe(true);
    expect(can("admin", "users.manage")).toBe(false);
  });
  it("every nav item is reachable by the owner", () => {
    for (const n of ADMIN_NAV) expect(can("owner", n.cap)).toBe(true);
  });
});
