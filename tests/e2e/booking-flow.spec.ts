import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { loadEnv } from "../../scripts/env";
import { CLEANER, OWNER } from "./accounts";
import { signIn } from "./helpers";

/**
 * The main business path on a phone: a customer requests a cleaning online, the owner confirms it,
 * assigns a cleaner, the cleaner sees it, and the owner records it as completed.
 */
test("public booking on mobile → confirm → assign → cleaner sees it → complete", async ({ page, browser }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e.${stamp}@example.test`;
  const name = `Taylor E2E ${stamp}`;

  // Customer side
  await page.goto("/quote");
  await page.getByText("Recurring Home Cleaning").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Approximate square footage").fill("1600");
  await page.getByText("Average — due for a good clean").click();
  await page.getByRole("radio", { name: "Yes" }).check();
  await page.getByLabel("Street address").fill("742 Synthetic Ave");
  await page.getByLabel("City").fill("Las Vegas");
  await page.getByLabel("ZIP code").fill("89123");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Every 2 weeks", { exact: false }).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Calculating your estimate…")).toHaveCount(0);
  await page.getByText("Request an appointment").click();
  await page.getByRole("button", { name: "Choose a time" }).click();
  // First day with openings, then its first time.
  const day = page.getByRole("radiogroup", { name: "Day" }).getByRole("radio").filter({ hasText: "open" }).first();
  await day.click();
  await page.locator('[role=radiogroup][aria-label$="times"] [role=radio]').first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Phone" }).fill("702-555-0188");
  await page.getByRole("checkbox", { name: /I agree/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(8500); // the API rejects submissions made faster than a person could fill in the form
  await page.getByRole("button", { name: "Submit booking request" }).click();
  await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
  // No email provider in local tests: the page must not claim an email went out.
  await expect(page.locator("body")).not.toContainText(/we('ve| have) emailed you/i);
  const reference = (await page.locator("strong.font-mono").first().textContent())!.trim();

  // Owner side
  const ownerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const owner = await ownerCtx.newPage();
  await signIn(owner, OWNER);
  await owner.goto(`/admin/appointments?status=pending&q=${encodeURIComponent(reference)}`);
  await owner.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(owner).toHaveURL(/\/admin\/appointments\/[0-9a-f-]+/);
  const apptUrl = owner.url();
  await owner.getByRole("button", { name: "Confirm" }).click();
  await expect(owner.getByText("Confirmed", { exact: true }).first()).toBeVisible();

  await owner.getByRole("button", { name: "Assign cleaner" }).click();
  const dialog = owner.getByRole("dialog");
  for (const box of await dialog.getByRole("checkbox", { checked: true }).all()) await box.uncheck();
  await dialog.getByText(CLEANER.name).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  const conflict = owner.getByRole("button", { name: /anyway/i });
  if (await conflict.isVisible().catch(() => false)) throw new Error("Unexpected conflict when assigning the test cleaner");
  await expect(owner.getByText(CLEANER.name).first()).toBeVisible();

  // Cleaner sees the job, without prices.
  const cleanerCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const cleaner = await cleanerCtx.newPage();
  await signIn(cleaner, CLEANER);
  await expect(cleaner).toHaveURL(/my-jobs/);
  await expect(cleaner.getByText("742 Synthetic Ave").first()).toBeVisible();

  // The visit happens: move it into the past (as time passing would), then record completion.
  loadEnv();
  const sql = postgres(process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const id = apptUrl.split("/").pop()!;
    await sql`update appointments set starts_at = now() - interval '4 hours', ends_at = now() - interval '1 hour' where id = ${id}`;
  } finally {
    await sql.end();
  }
  await owner.goto(apptUrl);
  await owner.getByRole("button", { name: "Mark complete" }).click();
  await owner.getByRole("button", { name: "Save job record" }).click();
  await expect(owner.getByText("Completed", { exact: true }).first()).toBeVisible();
  await ownerCtx.close();
  await cleanerCtx.close();
});
