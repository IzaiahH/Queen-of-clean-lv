import { db } from "@/lib/db";
import { appUrl, sendTemplatedEmail } from "@/lib/server/email";
import { errorResponse, json, readJson, tooFast } from "@/lib/server/http";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { loadSettings } from "@/lib/server/settings";
import { contactMessageSchema, zodErrors } from "@/lib/validation/booking";

export async function POST(req: Request) {
  try {
    const body = await readJson(req).catch(() => null);
    const parsed = contactMessageSchema.safeParse(body);
    if (!parsed.success) return json({ error: "Please check the highlighted fields.", fields: zodErrors(parsed.error) }, 422);
    const m = parsed.data;
    // Spam traps answer like a success so bots learn nothing, but nothing is stored or sent.
    if (m.website || tooFast(m.started_at)) return json({ ok: true });
    if (!(await rateLimit(`contact:${await clientIpHash()}`, 5, 3600))) return json({ error: "Too many messages from this connection. Please try again later or call us." }, 429);
    const [row] = await db()<{ id: string }[]>`
      insert into contact_messages (name, email, phone, message) values (${m.name}, ${m.email}, ${m.phone || null}, ${m.message}) returning id`;
    const settings = await loadSettings();
    for (const to of settings.notifications.admin_emails) {
      await sendTemplatedEmail("contact_message", to, { name: m.name, email: m.email, phone: m.phone || "no phone", message: m.message, admin_url: appUrl("/admin/customers?tab=messages") }, {}, { audience: "admin" });
    }
    return json({ ok: true, id: row.id });
  } catch (e) {
    return errorResponse(e);
  }
}
