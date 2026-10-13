import { expect, test } from "@playwright/test";
import { CLEANER } from "./accounts";
import { signIn } from "./helpers";

test.describe("signed-out visitors", () => {
  for (const path of ["/admin", "/admin/customers", "/admin/settings", "/admin/finance"]) {
    test(`${path} sends them to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login/);
    });
  }

  for (const path of ["/api/admin/calendar?start=2026-01-01&end=2026-02-01", "/api/admin/export/customers", "/api/cron/daily"]) {
    test(`${path} refuses data`, async ({ request }) => {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect(await r.text()).not.toContain("@example");
    });
  }

  test("public pages never show customer data or the admin calendar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).not.toContainText("private notes", { ignoreCase: true });
    const r = await page.request.get("/api/availability?service=recurring&minutes=120");
    expect(await r.text()).not.toMatch(/customer|address|@/i);
  });
});

test.describe("cleaner accounts", () => {
  test("see only My jobs and are kept out of office pages and data", async ({ page }) => {
    await signIn(page, CLEANER);
    await expect(page).toHaveURL(/\/admin\/my-jobs/);
    for (const path of ["/admin/customers", "/admin/finance", "/admin/settings", "/admin/pricing", "/admin/calendar"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/my-jobs/);
    }
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Customers" })).toHaveCount(0);
    for (const path of ["/api/admin/export/customers", "/api/admin/calendar?start=2026-01-01&end=2026-02-01"]) {
      const r = await page.request.get(path);
      expect(r.status()).toBe(403);
    }
    await expect(page.locator("body")).not.toContainText("$");
  });
});
