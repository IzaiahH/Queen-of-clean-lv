import "server-only";
import { db } from "@/lib/db";
import { sha256 } from "./security";

/** Customer-safe view of an appointment, looked up by the secret manage-link token. No internal notes, costs or access codes. */
export async function appointmentByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [a] = await db()<{
    id: string; reference: string; status: string; starts_at: Date; ends_at: Date; estimated_minutes: number; agreed_price_cents: number;
    service_slug: string; service_name: string; customer_first: string; address: string; frequency: string; customer_notes: string;
    open_request: string | null; requires_review: boolean;
  }[]>`
    select a.id, a.reference, a.status, a.starts_at, a.ends_at, a.estimated_minutes, a.agreed_price_cents, a.service_slug,
           coalesce(s.name, a.service_slug) as service_name, split_part(c.full_name, ' ', 1) as customer_first,
           concat_ws(', ', p.address_line1, p.unit, p.city) as address, a.frequency, a.customer_notes,
           (select kind from customer_requests r where r.appointment_id = a.id and r.status = 'open' limit 1) as open_request,
           coalesce(q.requires_review and q.status = 'draft', false) as requires_review
      from appointments a
      join customers c on c.id = a.customer_id
      join properties p on p.id = a.property_id
      left join services s on s.slug = a.service_slug
      left join quotes q on q.id = a.quote_id
     where a.manage_token_hash = ${sha256(token)}`;
  return a ?? null;
}

export async function quoteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [q] = await db()<{
    id: string; reference: string; status: string; estimate_cents: number; override_cents: number | null; recurring_cents: number | null;
    estimated_minutes: number; frequency: string; service_slug: string; service_name: string; customer_id: string | null; property_id: string | null;
    customer_first: string | null; expires_at: Date | null; requires_review: boolean; breakdown: { lines: { label: string; amount_cents: number }[]; notes: string[]; mode: string };
    has_appointment: boolean;
  }[]>`
    select q.id, q.reference, q.status, q.estimate_cents, q.override_cents, q.recurring_cents, q.estimated_minutes, q.frequency, q.service_slug,
           coalesce(s.name, q.service_slug) as service_name, q.customer_id, q.property_id, split_part(c.full_name, ' ', 1) as customer_first,
           q.expires_at, q.requires_review, q.breakdown,
           exists (select 1 from appointments a where a.quote_id = q.id and a.status in ('pending','confirmed','completed')) as has_appointment
      from quotes q left join customers c on c.id = q.customer_id left join services s on s.slug = q.service_slug
     where q.public_token_hash = ${sha256(token)}`;
  return q ?? null;
}
