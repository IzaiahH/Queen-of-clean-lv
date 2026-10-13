"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/server/audit";
import { emailConfigured, sendTemplatedEmail } from "@/lib/server/email";
import { saveSetting } from "@/lib/server/settings";
import { settingsSchemas, type Settings, type SettingsKey } from "@/lib/settings/schema";
import { guard } from "./guard";

export async function saveSettingAction<K extends SettingsKey>(key: K, value: Settings[K]) {
  return guard("settings.edit", async (user, actor) => {
    if (!(key in settingsSchemas)) return { ok: false, error: "Unknown setting" };
    if (key === "business") {
      const logo = (value as Settings["business"]).logo_data_url;
      if (logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) return { ok: false, error: "Logo must be a PNG, JPG or WebP image." };
    }
    await saveSetting(key, value, user.id);
    await audit(actor, "settings.update", "settings", null, { key });
    return { ok: true, message: "Settings saved. They take effect right away." };
  });
}

export async function sendTestEmailAction(template: string) {
  return guard("settings.edit", async (user) => {
    if (!emailConfigured()) return { ok: false, error: "Email isn't set up yet: add RESEND_API_KEY and EMAIL_FROM on the server." };
    const r = await sendTemplatedEmail(z.string().max(60).parse(template), user.email, {
      first_name: user.full_name.split(" ")[0], reference: "TEST-123", service: "Recurring Home Cleaning", date_time: "Mon, Jan 5 at 9:00 AM", date: "Mon, Jan 5",
      estimate: "$185.00", price: "$185.00", manage_url: "(link appears here)", quote_url: "(link appears here)", expires: "Feb 4", message: "", status: "confirmed",
      customer_name: "Sample Customer", review_reasons: "none", admin_url: "(link)", cancellation_policy: "(policy)", response_time: "",
    }, {}, { audience: "admin" });
    return r.status === "sent" ? { ok: true, message: `Test email sent to ${user.email}.` } : { ok: false, error: `Not sent: ${r.error ?? r.status}` };
  });
}

const testimonial = z.object({
  author_name: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(1500), context: z.string().max(120),
  permission_confirmed: z.boolean(), published: z.boolean(), sort: z.number().int().min(0).max(999),
});
export async function saveTestimonialAction(id: string | null, input: z.input<typeof testimonial>) {
  return guard("settings.edit", async (_u, actor) => {
    const d = testimonial.parse(input);
    if (d.published && !d.permission_confirmed) return { ok: false, error: "Confirm you have the customer's permission before publishing." };
    if (id) await db()`update testimonials set author_name = ${d.author_name}, body = ${d.body}, context = ${d.context}, permission_confirmed = ${d.permission_confirmed}, published = ${d.published}, sort = ${d.sort} where id = ${z.string().uuid().parse(id)}`;
    else await db()`insert into testimonials (author_name, body, context, permission_confirmed, published, sort) values (${d.author_name}, ${d.body}, ${d.context}, ${d.permission_confirmed}, ${d.published}, ${d.sort})`;
    await audit(actor, "testimonial.save", "testimonial", id, { published: d.published });
    return { ok: true, message: d.published ? "Saved and shown on the website." : "Saved (not shown on the website)." };
  });
}
export async function deleteTestimonialAction(id: string) {
  return guard("settings.edit", async (_u, actor) => {
    await db()`delete from testimonials where id = ${z.string().uuid().parse(id)}`;
    await audit(actor, "testimonial.delete", "testimonial", id);
    return { ok: true, message: "Removed." };
  });
}
