import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit, SYSTEM_ACTOR } from "@/lib/server/audit";
import { sendDueCustomerEmails } from "@/lib/server/appointments";
import { expireQuotes } from "@/lib/server/quotes-admin";
import { generateAllSeries } from "@/lib/server/series";
import { loadSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || (secret.length < 16 && process.env.NODE_ENV === "production")) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily housekeeping, called by Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`.
 * Each step runs independently so one failure doesn't stop the rest; the summary is audited.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { result[name] = await fn(); } catch (e) { result[name] = { error: e instanceof Error ? e.message : String(e) }; }
  };
  await step("recurring", () => generateAllSeries());
  await step("emails", () => sendDueCustomerEmails());
  await step("quotes_expired", () => expireQuotes());
  await step("cleanup", async () => {
    const s = await loadSettings();
    const msgs = await db()`delete from contact_messages where status in ('handled','spam') and created_at < now() - make_interval(days => ${s.privacy.contact_message_retention_days})`;
    const sessions = await db()`delete from sessions where expires_at < now()`;
    const limits = await db()`delete from rate_limits where window_start < now() - interval '1 day'`;
    return { contact_messages: msgs.count, sessions: sessions.count, rate_limits: limits.count };
  });
  await audit(SYSTEM_ACTOR, "cron.daily", "system", null, result);
  return Response.json({ ok: true, ...result });
}
