import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { loadEnv } from "../../scripts/env";
import { OWNER } from "./accounts";
import { signIn } from "./helpers";

/** Owner imports existing customers on a phone, re-runs safely, then books one at their historical rate. */
test("existing-customer import → profile shows historical rate → booking uses it", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const names = [`Quinn Fiction ${stamp}`, `Remy Pretend ${stamp}`];
  const file = {
    source: `E2E ${stamp}`,
    rate_basis: "per_visit",
    customers: [
      { ref: `e2e-${stamp}-a`, name: names[0], frequency: "monthly", rate: 285, bedrooms: 2, bathrooms: 1, sqft: 1000 },
      { ref: `e2e-${stamp}-b`, name: names[1], frequency: "biweekly", rate: 310, bedrooms: 3, bathrooms: 2.5, sqft: 2100 },
    ],
  };
  const upload = { name: "existing.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) };

  await signIn(page, OWNER);
  await page.goto("/admin/import-export");
  const section = page.locator("div.card", { has: page.getByRole("heading", { name: "Existing customers with historical rates" }) });
  await section.locator('input[type="file"]').setInputFiles(upload);
  await section.getByRole("button", { name: "Preview import" }).click();
  await expect(section.getByText(/Preview \(nothing saved\) · 2 to create/)).toBeVisible();
  await section.getByRole("button", { name: "Apply import" }).click();
  await expect(section.getByText(/^Applied · 2 to create/)).toBeVisible();

  // Running it again is safe.
  await section.getByRole("button", { name: "Preview import" }).click();
  await expect(section.getByText(/0 to create · 2 unchanged/)).toBeVisible();

  // Profile: verify banner and the exact historical rate.
  await page.goto(`/admin/customers?status=unverified&q=${encodeURIComponent(names[0])}`);
  await page.getByRole("link", { name: new RegExp(names[0]) }).first().click();
  await expect(page.getByText("Existing client — verify current status").first()).toBeVisible();
  const rates = page.locator("section", { has: page.getByRole("heading", { name: "Customer rates" }) });
  await expect(rates.getByText("$285")).toBeVisible();
  await expect(rates.getByText(/Historical rate from existing records/)).toBeVisible();

  // Booking dialog offers and pre-fills that rate.
  await page.getByRole("button", { name: "Book cleaning" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`Rates on file for ${names[0]}`)).toBeVisible();
  await expect(dialog.getByLabel("Price per visit")).toHaveValue("285");
  await dialog.getByRole("button", { name: "Use this rate" }).click();
  await expect(dialog.getByLabel("Repeats")).toHaveValue("monthly");
  await expect(dialog.getByText("Historical rate for this customer: $285")).toBeVisible();
  await dialog.getByLabel("Price per visit").fill("295");
  await expect(dialog.getByText(/The price entered is different/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Owner confirms they're still a client.
  await page.getByRole("button", { name: "Confirm active" }).click();
  await expect(page.getByRole("button", { name: "Confirm active" })).toHaveCount(0);

  // Clean up the synthetic records.
  loadEnv();
  const sql = postgres(process.env.E2E_DATABASE_URL || process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    await sql`delete from customers where import_ref like ${`e2e-${stamp}-%`}`;
  } finally {
    await sql.end();
  }
});
