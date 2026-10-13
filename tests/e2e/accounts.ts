/** Synthetic accounts created by global-setup. Override with env vars when testing a staging deploy. */
export const OWNER = { email: process.env.E2E_OWNER_EMAIL ?? "e2e.owner@example.test", password: process.env.E2E_OWNER_PASSWORD ?? "e2e-owner-password-123" };
export const CLEANER = { email: process.env.E2E_CLEANER_EMAIL ?? "e2e.cleaner@example.test", password: process.env.E2E_CLEANER_PASSWORD ?? "e2e-cleaner-password-123", name: "E2E Cleaner" };
