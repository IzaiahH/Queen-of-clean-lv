"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getAppointmentDetail } from "@/lib/server/admin-queries";
import { audit } from "@/lib/server/audit";
import { guard } from "./guard";

export async function appointmentPanelAction(id: string) {
  return guard("schedule.view", async (user) => {
    const d = await getAppointmentDetail(z.string().uuid().parse(id));
    if (!d) return { ok: false, error: "Appointment not found" };
    // Pay details are owner/admin only.
    if (!["owner", "admin"].includes(user.role)) {
      d.assignments = d.assignments.map((x) => ({ ...x, pay_rate_cents: 0, pay_percent: 0 }));
      d.labor = d.labor.map((l) => ({ ...l, pay_cents: 0, pay_basis: "" }));
      d.laborCents = 0;
      d.profit = null;
      d.estimatedLabor = 0;
    }
    return { ok: true, data: d };
  });
}

export async function searchCustomersAction(q: string) {
  return guard("customers.view", async () => {
    const term = `%${z.string().max(100).parse(q).trim().toLowerCase()}%`;
    const rows = await db()<{ id: string; full_name: string; email: string | null; phone: string | null; properties: { id: string; label: string; address: string | null; has_address: boolean }[]; last_price: number | null; last_minutes: number | null }[]>`
      select c.id, c.full_name, c.email, c.phone,
             coalesce((select json_agg(json_build_object('id', p.id, 'label', p.label, 'address', concat_ws(', ', p.address_line1, p.unit, p.city), 'has_address', p.address_line1 is not null) order by p.is_primary desc)
                       from properties p where p.customer_id = c.id), '[]') as properties,
             (select agreed_price_cents from appointments a where a.customer_id = c.id order by starts_at desc limit 1) as last_price,
             (select estimated_minutes from appointments a where a.customer_id = c.id order by starts_at desc limit 1) as last_minutes
        from customers c
       where c.status <> 'archived' and c.merged_into_id is null
         and (lower(c.full_name) like ${term} or lower(coalesce(c.email,'')) like ${term} or coalesce(c.phone,'') like ${term})
       order by c.full_name limit 15`;
    return { ok: true, data: Array.from(rows) };
  });
}

export async function createBlockAction(startsAt: string, endsAt: string, reason: string) {
  return guard("schedule.edit", async (user, actor) => {
    const s = z.string().datetime({ offset: true }).parse(startsAt);
    const e = z.string().datetime({ offset: true }).parse(endsAt);
    if (new Date(e) <= new Date(s)) return { ok: false, error: "End must be after start" };
    const [row] = await db()<{ id: string }[]>`insert into blocked_periods (starts_at, ends_at, reason, created_by) values (${s}, ${e}, ${z.string().max(200).parse(reason)}, ${user.id}) returning id`;
    await audit(actor, "block.create", "blocked_period", row.id, { s, e, reason });
    return { ok: true, message: "Time blocked. Customers can't book it." };
  });
}

export async function deleteBlockAction(id: string) {
  return guard("schedule.edit", async (_u, actor) => {
    await db()`delete from blocked_periods where id = ${z.string().uuid().parse(id)}`;
    await audit(actor, "block.delete", "blocked_period", id);
    return { ok: true, message: "Blocked time removed." };
  });
}
