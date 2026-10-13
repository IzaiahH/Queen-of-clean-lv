import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { audit, type Actor } from "./audit";
import { customerFinancials } from "./admin-queries";

export const customerInputSchema = z.object({
  full_name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).or(z.literal("")).transform((v) => v || null),
  phone: z.string().trim().max(40).transform((v) => v || null),
  preferred_contact: z.enum(["email", "phone", "text"]),
  status: z.enum(["lead", "active", "inactive", "archived"]),
  preferences: z.string().max(3000),
  private_notes: z.string().max(5000),
  source: z.enum(["website", "admin", "import", "referral"]).default("admin"),
  marketing_consent: z.boolean().default(false),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export const propertyEditSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address_line1: z.string().trim().max(200).transform((v) => v || null),
  unit: z.string().trim().max(40).transform((v) => v || null),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(2).max(2).default("NV"),
  zip: z.string().trim().regex(/^(\d{5})?$/, "ZIP must be 5 digits").transform((v) => v || null),
  property_type: z.enum(["house", "townhome", "condo", "apartment", "other"]),
  bedrooms: z.number().int().min(0).max(20).nullable(),
  full_baths: z.number().int().min(0).max(20).nullable(),
  half_baths: z.number().int().min(0).max(20),
  sqft: z.number().int().min(100).max(50000).nullable(),
  pets: z.string().max(300),
  condition: z.enum(["light", "standard", "heavy", "extreme"]).nullable(),
  access_instructions: z.string().max(2000),
  special_requirements: z.string().max(2000),
  is_primary: z.boolean(),
});
export type PropertyEdit = z.input<typeof propertyEditSchema>;

export type CustomerListRow = {
  id: string; full_name: string; email: string | null; phone: string | null; status: string; source: string; created_at: Date;
  city: string | null; area: string | null; last_visit: Date | null; next_visit: Date | null; completed_count: number; lifetime_cents: number; recurring: string | null;
};

export async function listCustomers(f: { q?: string; status?: string; sort?: string; area?: string; limit: number; offset: number }) {
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const digits = f.q?.replace(/\D/g, "") ?? "";
  const qd = digits.length >= 3 ? `%${digits}%` : null;
  const status = f.status && f.status !== "all" ? f.status : null;
  const sort = f.sort ?? "name";
  const rows = await db()<CustomerListRow[]>`
    select c.id, c.full_name, c.email, c.phone, c.status, c.source, c.created_at,
           p.city, sa.name as area,
           (select max(starts_at) from appointments a where a.customer_id = c.id and a.status = 'completed') as last_visit,
           (select min(starts_at) from appointments a where a.customer_id = c.id and a.status in ('pending','confirmed') and a.starts_at > now()) as next_visit,
           (select count(*)::int from appointments a where a.customer_id = c.id and a.status = 'completed') as completed_count,
           (select coalesce(sum(j.revenue_cents),0)::int from job_records j join appointments a on a.id = j.appointment_id where a.customer_id = c.id and a.status = 'completed') as lifetime_cents,
           (select frequency from recurring_series s where s.customer_id = c.id and s.status = 'active' limit 1) as recurring
      from customers c
      left join lateral (select * from properties p where p.customer_id = c.id order by is_primary desc, created_at limit 1) p on true
      left join service_areas sa on sa.id = p.service_area_id
     where c.merged_into_id is null
       and (${status}::text is null or c.status = ${status})
       and (${status}::text is not null or c.status <> 'archived')
       and (${f.area || null}::uuid is null or p.service_area_id = ${f.area || null})
       and (${q}::text is null or lower(c.full_name) like ${q} or lower(coalesce(c.email,'')) like ${q}
            or (${qd}::text is not null and c.phone_digits like ${qd})
            or exists (select 1 from properties pp where pp.customer_id = c.id and lower(coalesce(pp.address_line1,'')) like ${q}))
     order by
       case when ${sort} = 'recent' then extract(epoch from c.created_at) end desc nulls last,
       case when ${sort} = 'value' then (select coalesce(sum(j.revenue_cents),0) from job_records j join appointments a on a.id = j.appointment_id where a.customer_id = c.id) end desc nulls last,
       case when ${sort} = 'last_visit' then (select max(starts_at) from appointments a where a.customer_id = c.id and a.status = 'completed') end desc nulls last,
       lower(c.full_name)
     limit ${f.limit} offset ${f.offset}`;
  return Array.from(rows);
}

export async function getCustomerProfile(id: string) {
  const sql = db();
  const [c] = await sql<{
    id: string; full_name: string; email: string | null; phone: string | null; preferred_contact: string; status: string; customer_since: string | null;
    preferences: string; private_notes: string; source: string; marketing_consent: boolean; booking_comms_consent: boolean; merged_into_id: string | null; created_at: Date;
  }[]>`select id, full_name, email, phone, preferred_contact, status, customer_since::text, preferences, private_notes, source, marketing_consent, booking_comms_consent, merged_into_id, created_at from customers where id = ${id}`;
  if (!c) return null;
  const [properties, appointments, quotes, series, comms, payments, duplicates, messages] = await Promise.all([
    sql<(PropertyEdit & { id: string; area: string | null; appt_count: number })[]>`
      select p.id, p.label, p.address_line1, p.unit, p.city, p.state, p.zip, p.property_type, p.bedrooms, p.full_baths, p.half_baths, p.sqft, p.pets, p.condition,
             p.access_instructions, p.special_requirements, p.is_primary, sa.name as area,
             (select count(*)::int from appointments a where a.property_id = p.id) + (select count(*)::int from recurring_series s where s.property_id = p.id) as appt_count
        from properties p left join service_areas sa on sa.id = p.service_area_id where p.customer_id = ${id} order by p.is_primary desc, p.created_at`,
    sql<{ id: string; reference: string; status: string; starts_at: Date; service_name: string; agreed_price_cents: number; series_id: string | null; cleaner_names: string[]; revenue_cents: number | null }[]>`
      select a.id, a.reference, a.status, a.starts_at, coalesce(s.name, a.service_slug) as service_name, a.agreed_price_cents, a.series_id,
             coalesce((select array_agg(cl.full_name order by cl.full_name) from appointment_assignments x join cleaners cl on cl.id = x.cleaner_id where x.appointment_id = a.id), '{}') as cleaner_names,
             (select revenue_cents from job_records j where j.appointment_id = a.id) as revenue_cents
        from appointments a left join services s on s.slug = a.service_slug where a.customer_id = ${id} order by a.starts_at desc limit 200`,
    sql<{ id: string; reference: string; status: string; service_slug: string; frequency: string; estimate_cents: number; override_cents: number | null; created_at: Date }[]>`
      select id, reference, status, service_slug, frequency, estimate_cents, override_cents, created_at from quotes where customer_id = ${id} order by created_at desc`,
    sql<{ id: string; frequency: string; interval_days: number | null; status: string; price_cents: number; start_time: string; anchor_date: string; service_slug: string }[]>`
      select id, frequency, interval_days, status, price_cents, start_time::text, anchor_date::text, service_slug from recurring_series where customer_id = ${id} order by created_at desc`,
    sql<{ id: string; template: string; subject: string; status: string; error: string | null; created_at: Date }[]>`
      select id, template, subject, status, error, created_at from communications where customer_id = ${id} order by created_at desc limit 50`,
    sql<{ id: string; amount_cents: number; method: string; received_at: Date; notes: string; appointment_id: string | null }[]>`
      select id, amount_cents, method, received_at, notes, appointment_id from payments where customer_id = ${id} order by received_at desc`,
    findDuplicates(sql, { id, email: c.email, phone: c.phone, full_name: c.full_name }),
    c.email ? sql<{ id: string; message: string; status: string; created_at: Date }[]>`select id, message, status, created_at from contact_messages where lower(email) = lower(${c.email}) order by created_at desc limit 20` : Promise.resolve([]),
  ]);
  return {
    c: { ...c },
    properties: Array.from(properties).map((p) => ({ ...p })),
    appointments: Array.from(appointments).map((a) => ({ ...a })),
    quotes: Array.from(quotes).map((q) => ({ ...q })),
    series: Array.from(series).map((s) => ({ ...s })),
    comms: Array.from(comms).map((x) => ({ ...x })),
    payments: Array.from(payments).map((x) => ({ ...x })),
    duplicates,
    messages: Array.from(messages).map((x) => ({ ...x })),
    finance: await customerFinancials(id),
  };
}

export async function findDuplicates(tx: Tx, c: { id?: string; email: string | null; phone: string | null; full_name: string }) {
  const digits = (c.phone ?? "").replace(/\D/g, "").slice(-10);
  const rows = await tx<{ id: string; full_name: string; email: string | null; phone: string | null; reason: string }[]>`
    select id, full_name, email, phone,
           case when ${c.email}::text is not null and lower(email) = lower(${c.email}) then 'Same email'
                when ${digits.length >= 10 ? digits : null}::text is not null and right(phone_digits, 10) = ${digits} then 'Same phone'
                else 'Same name' end as reason
      from customers
     where merged_into_id is null and id <> coalesce(${c.id ?? null}::uuid, '00000000-0000-0000-0000-000000000000')
       and ((${c.email}::text is not null and lower(email) = lower(${c.email}))
         or (${digits.length >= 10 ? digits : null}::text is not null and right(phone_digits, 10) = ${digits})
         or lower(regexp_replace(full_name, '\\s+', ' ', 'g')) = lower(regexp_replace(${c.full_name}, '\\s+', ' ', 'g')))
     limit 10`;
  return Array.from(rows).map((r) => ({ ...r }));
}

async function areaForZip(tx: Tx, zip: string | null): Promise<string | null> {
  if (!zip) return null;
  const [a] = await tx<{ id: string }[]>`select id from service_areas where ${zip} = any(zip_codes) order by sort limit 1`;
  return a?.id ?? null;
}

export async function createCustomer(actor: Actor, input: CustomerInput, property: PropertyEdit | null) {
  const c = customerInputSchema.parse(input);
  const p = property ? propertyEditSchema.parse(property) : null;
  return db().begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into customers (full_name, email, phone, preferred_contact, status, preferences, private_notes, source, marketing_consent, customer_since)
      values (${c.full_name}, ${c.email}, ${c.phone}, ${c.preferred_contact}, ${c.status}, ${c.preferences}, ${c.private_notes}, ${c.source}, ${c.marketing_consent},
              ${c.status === "active" ? new Date() : null})
      returning id`;
    if (p) await insertProperty(tx, row.id, p);
    await audit(actor, "customer.create", "customer", row.id, {}, tx);
    return row.id;
  });
}

export async function updateCustomer(actor: Actor, id: string, input: CustomerInput) {
  const c = customerInputSchema.parse(input);
  await db()`
    update customers set full_name = ${c.full_name}, email = ${c.email}, phone = ${c.phone}, preferred_contact = ${c.preferred_contact}, status = ${c.status},
           preferences = ${c.preferences}, private_notes = ${c.private_notes}, marketing_consent = ${c.marketing_consent},
           customer_since = case when ${c.status} = 'active' then coalesce(customer_since, current_date) else customer_since end
     where id = ${id}`;
  await audit(actor, "customer.update", "customer", id);
}

async function insertProperty(tx: Tx, customerId: string, p: z.output<typeof propertyEditSchema>) {
  if (p.is_primary) await tx`update properties set is_primary = false where customer_id = ${customerId}`;
  const [row] = await tx<{ id: string }[]>`
    insert into properties (customer_id, label, address_line1, unit, city, state, zip, service_area_id, property_type, bedrooms, full_baths, half_baths, sqft, pets, condition, access_instructions, special_requirements, is_primary)
    values (${customerId}, ${p.label}, ${p.address_line1}, ${p.unit}, ${p.city}, ${p.state.toUpperCase()}, ${p.zip}, ${await areaForZip(tx, p.zip)}, ${p.property_type}, ${p.bedrooms}, ${p.full_baths},
            ${p.half_baths}, ${p.sqft}, ${p.pets}, ${p.condition}, ${p.access_instructions}, ${p.special_requirements}, ${p.is_primary})
    returning id`;
  return row.id;
}

export async function saveProperty(actor: Actor, customerId: string, propertyId: string | null, input: PropertyEdit) {
  const p = propertyEditSchema.parse(input);
  return db().begin(async (tx) => {
    if (!propertyId) {
      const id = await insertProperty(tx, customerId, p);
      await audit(actor, "property.create", "property", id, {}, tx);
      return id;
    }
    if (p.is_primary) await tx`update properties set is_primary = false where customer_id = ${customerId} and id <> ${propertyId}`;
    const r = await tx`
      update properties set label = ${p.label}, address_line1 = ${p.address_line1}, unit = ${p.unit}, city = ${p.city}, state = ${p.state.toUpperCase()}, zip = ${p.zip},
             service_area_id = ${await areaForZip(tx, p.zip)}, property_type = ${p.property_type}, bedrooms = ${p.bedrooms}, full_baths = ${p.full_baths}, half_baths = ${p.half_baths},
             sqft = ${p.sqft}, pets = ${p.pets}, condition = ${p.condition}, access_instructions = ${p.access_instructions}, special_requirements = ${p.special_requirements}, is_primary = ${p.is_primary}
       where id = ${propertyId} and customer_id = ${customerId}`;
    if (!r.count) throw new Error("Property not found");
    await audit(actor, "property.update", "property", propertyId, {}, tx);
    return propertyId;
  });
}

export async function deleteProperty(actor: Actor, customerId: string, propertyId: string) {
  return db().begin(async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`
      select (select count(*)::int from appointments where property_id = ${propertyId}) + (select count(*)::int from recurring_series where property_id = ${propertyId}) as n`;
    if (n > 0) return { ok: false as const, error: "This property has appointments. Keep it for history." };
    await tx`delete from properties where id = ${propertyId} and customer_id = ${customerId}`;
    await audit(actor, "property.delete", "property", propertyId, {}, tx);
    return { ok: true as const };
  });
}

/**
 * Moves everything from `mergeId` onto `keepId`, fills blank contact fields, appends notes,
 * then archives the merged record (kept for audit, hidden from lists).
 */
export async function mergeCustomers(actor: Actor, keepId: string, mergeId: string) {
  if (keepId === mergeId) return { ok: false as const, error: "Choose two different customers" };
  return db().begin(async (tx) => {
    const rows = await tx<{ id: string; full_name: string; email: string | null; phone: string | null; preferences: string; private_notes: string; merged_into_id: string | null; customer_since: string | null }[]>`
      select id, full_name, email, phone, preferences, private_notes, merged_into_id, customer_since::text from customers where id in (${keepId}, ${mergeId}) for update`;
    const keep = rows.find((r) => r.id === keepId);
    const drop = rows.find((r) => r.id === mergeId);
    if (!keep || !drop) return { ok: false as const, error: "Customer not found" };
    if (keep.merged_into_id || drop.merged_into_id) return { ok: false as const, error: "One of these records was already merged" };
    for (const table of ["properties", "appointments", "quotes", "recurring_series", "payments", "communications"] as const)
      await tx`update ${tx(table)} set customer_id = ${keepId} where customer_id = ${mergeId}`;
    await tx`update properties set is_primary = false where customer_id = ${keepId} and id not in (select id from properties where customer_id = ${keepId} order by is_primary desc, created_at limit 1)`;
    const join = (a: string, b: string, label: string) => (b.trim() ? (a.trim() ? `${a}\n\n[${label}] ${b}` : b) : a);
    await tx`
      update customers set
        email = coalesce(email, ${drop.email}), phone = coalesce(phone, ${drop.phone}),
        preferences = ${join(keep.preferences, drop.preferences, `From merged record ${drop.full_name}`)},
        private_notes = ${join(keep.private_notes, drop.private_notes, `From merged record ${drop.full_name}`)},
        customer_since = least(customer_since, ${drop.customer_since}::date)
       where id = ${keepId}`;
    await tx`update customers set status = 'archived', merged_into_id = ${keepId} where id = ${mergeId}`;
    await audit(actor, "customer.merge", "customer", keepId, { merged: mergeId, merged_name: drop.full_name, merged_email: drop.email, merged_phone: drop.phone }, tx);
    return { ok: true as const };
  });
}
