import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit, type Actor } from "./audit";

/**
 * Customer-specific rates (historical rates from existing records, or custom rates agreed later).
 * Separate from the public pricing engine: nothing here is recalculated, and only the customer it
 * belongs to ever sees or uses it.
 */
export type CustomerRate = {
  id: string;
  service_slug: string;
  service_name: string;
  frequency: string;
  price_cents: number;
  kind: "historical" | "custom";
  status: "active" | "retired";
  source: "import" | "admin";
  notes: string;
  created_at: Date;
  retired_at: Date | null;
};

export async function listCustomerRates(customerId: string, tx: Tx = db()): Promise<CustomerRate[]> {
  const rows = await tx<CustomerRate[]>`
    select r.id, r.service_slug, coalesce(s.name, r.service_slug) as service_name, r.frequency, r.price_cents, r.kind, r.status, r.source, r.notes, r.created_at, r.retired_at
      from customer_rates r left join services s on s.slug = r.service_slug
     where r.customer_id = ${customerId}
     order by (r.status = 'active') desc, r.created_at desc`;
  return Array.from(rows).map((r) => ({ ...r }));
}

export const rateInput = z.object({
  service_slug: z.string().trim().min(1).max(40),
  frequency: z.enum(["weekly", "biweekly", "monthly", "quarterly", "one_time"]),
  price_cents: z.number().int().min(1).max(1_000_000),
  notes: z.string().trim().max(500).default(""),
});

/** Sets the customer's rate for a service and frequency. Any previous active rate is retired, never edited, so history stays intact. */
export async function setCustomerRate(actor: Actor, customerId: string, input: z.input<typeof rateInput>) {
  const d = rateInput.parse(input);
  return db().begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`select id from customers where id = ${customerId} and merged_into_id is null for update`;
    if (!c) throw new Error("Customer not found");
    const [svc] = await tx<{ slug: string }[]>`select slug from services where slug = ${d.service_slug}`;
    if (!svc) throw new Error("Unknown service");
    const old = await tx<{ id: string; price_cents: number }[]>`
      update customer_rates set status = 'retired', retired_at = now(), retired_by = ${actor.id}
       where customer_id = ${customerId} and service_slug = ${d.service_slug} and frequency = ${d.frequency} and status = 'active'
       returning id, price_cents`;
    const [row] = await tx<{ id: string }[]>`
      insert into customer_rates (customer_id, service_slug, frequency, price_cents, kind, source, notes, created_by)
      values (${customerId}, ${d.service_slug}, ${d.frequency}, ${d.price_cents}, 'custom', 'admin', ${d.notes}, ${actor.id})
      returning id`;
    await audit(actor, "customer.rate_set", "customer", customerId, { rate_id: row.id, frequency: d.frequency, service: d.service_slug, price_cents: d.price_cents, replaced_cents: old[0]?.price_cents ?? null }, tx);
    return row.id;
  });
}

export async function retireCustomerRate(actor: Actor, customerId: string, rateId: string) {
  const rows = await db()`
    update customer_rates set status = 'retired', retired_at = now(), retired_by = ${actor.id}
     where id = ${rateId} and customer_id = ${customerId} and status = 'active'`;
  if (rows.count) await audit(actor, "customer.rate_retired", "customer", customerId, { rate_id: rateId });
  return rows.count > 0;
}
