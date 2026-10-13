import "server-only";
import { db, type Tx } from "@/lib/db";
import { loadSettings } from "./settings";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function appUrl(path = ""): string {
  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? "" : String(v);
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function toHtml(text: string, businessName: string): string {
  const body = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#8E6B2E">$1</a>')
    .replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#F7F1E5;font-family:Helvetica,Arial,sans-serif;color:#292725">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E4CB8B">
<tr><td style="background:#101010;color:#C5A15B;padding:20px 28px;font-family:Georgia,serif;font-size:22px;letter-spacing:2px">${escapeHtml(businessName.toUpperCase())}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${body}</td></tr>
</table></td></tr></table></body></html>`;
}

export type SendResult = { status: "sent" | "failed" | "skipped"; id: string; error?: string };

type Links = { customer_id?: string | null; appointment_id?: string | null; quote_id?: string | null };

async function deliver(to: string, subject: string, text: string, businessName: string): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        html: toHtml(text, businessName),
        reply_to: process.env.EMAIL_REPLY_TO || undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: data.message ?? `Resend returned HTTP ${res.status}` };
    return { ok: true, providerId: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Renders a template, logs it, and attempts delivery. Every call leaves an honest log row:
 * "sent" only when the provider accepted it, "skipped" when email isn't configured or disabled,
 * "failed" with the provider's error otherwise.
 */
export async function sendTemplatedEmail(
  template: string,
  to: string | null | undefined,
  vars: Record<string, string | number | null | undefined>,
  links: Links,
  opts: { audience: "customer" | "admin"; tx?: Tx } = { audience: "customer" },
): Promise<SendResult> {
  const sql = opts.tx ?? db();
  const settings = await loadSettings(sql);
  const tpl = settings.email_templates[template];
  const allVars = { business_name: settings.business.name, ...vars };
  const subject = tpl ? renderTemplate(tpl.subject, allVars) : template;
  const body = tpl ? renderTemplate(tpl.body, allVars) : "";
  let skipReason: string | null = null;
  if (!tpl) skipReason = `No "${template}" email template`;
  else if (!to) skipReason = "No email address on file";
  else if (opts.audience === "customer" && !settings.notifications.customer_emails_enabled) skipReason = "Customer emails are turned off in Settings";
  else if (!emailConfigured()) skipReason = "Email provider not configured (RESEND_API_KEY / EMAIL_FROM)";

  const [row] = await sql<{ id: string }[]>`
    insert into communications (customer_id, appointment_id, quote_id, channel, template, recipient, subject, body_text, status, provider, error)
    values (${links.customer_id ?? null}, ${links.appointment_id ?? null}, ${links.quote_id ?? null}, 'email', ${template},
            ${to ?? "(none)"}, ${subject}, ${body}, ${skipReason ? "skipped" : "queued"}, ${skipReason ? null : "resend"}, ${skipReason})
    returning id`;
  if (skipReason) return { status: "skipped", id: row.id, error: skipReason };
  return attemptDelivery(row.id, to!, subject, body, settings.business.name, sql);
}

async function attemptDelivery(id: string, to: string, subject: string, body: string, businessName: string, sql: Tx): Promise<SendResult> {
  const result = await deliver(to, subject, body, businessName);
  if (result.ok) {
    await sql`update communications set status = 'sent', provider_message_id = ${result.providerId ?? null}, attempts = attempts + 1, sent_at = now(), error = null where id = ${id}`;
    return { status: "sent", id };
  }
  await sql`update communications set status = 'failed', attempts = attempts + 1, error = ${result.error ?? "Unknown error"} where id = ${id}`;
  return { status: "failed", id, error: result.error };
}

/** Manual retry from the communication log. Only failed/skipped emails can be retried. */
export async function retryCommunication(id: string): Promise<SendResult> {
  const sql = db();
  const [c] = await sql<{ id: string; recipient: string; subject: string; body_text: string; status: string; channel: string; attempts: number }[]>`
    select id, recipient, subject, body_text, status, channel, attempts from communications where id = ${id}`;
  if (!c) throw new Error("Message not found");
  if (c.channel !== "email" || !["failed", "skipped"].includes(c.status)) throw new Error("Only failed or skipped emails can be retried");
  if (c.attempts >= 5) throw new Error("This email has already been retried 5 times");
  if (!emailConfigured()) return { status: "skipped", id, error: "Email provider not configured" };
  if (!c.recipient.includes("@")) return { status: "skipped", id, error: "No valid recipient" };
  const settings = await loadSettings(sql);
  await sql`update communications set status = 'queued', provider = 'resend' where id = ${id}`;
  return attemptDelivery(id, c.recipient, c.subject, c.body_text, settings.business.name, sql);
}

export function describeSend(r: SendResult, who = "customer"): string {
  if (r.status === "sent") return `Email sent to the ${who}.`;
  if (r.status === "skipped") return `No email was sent to the ${who}: ${r.error}.`;
  return `Email to the ${who} failed: ${r.error}. You can retry it from the communication log.`;
}
