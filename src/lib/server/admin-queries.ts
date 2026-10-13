import "server-only";
import { db } from "@/lib/db";
import { getPublishedPricing } from "@/lib/server/catalog";
import { estimatedLaborCents, jobProfit, monthlyRecurringProjection, periodSummary, type PayMethod } from "@/lib/finance/calc";

export type Range = { from: Date; to: Date };

/** One place that totals money for a period, so the dashboard, finance page and reports agree. */
export async function financeTotals(r: Range) {
  const sql = db();
  const [row] = await sql<{
    completed_revenue: number; booked: number; pending_value: number; labor: number; job_supplies: number; job_other: number;
    expenses: number; est_expenses: number; completed_jobs: number; upcoming_unfinished: number;
  }[]>`
    select
      (select coalesce(sum(j.revenue_cents),0)::int from job_records j join appointments a on a.id = j.appointment_id
        where a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}) as completed_revenue,
      (select coalesce(sum(agreed_price_cents),0)::int from appointments where status in ('confirmed','completed') and starts_at >= ${r.from} and starts_at < ${r.to}) as booked,
      (select coalesce(sum(agreed_price_cents),0)::int from appointments where status = 'pending' and starts_at >= ${r.from} and starts_at < ${r.to}) as pending_value,
      (select coalesce(sum(l.pay_cents),0)::int from labor_records l join appointments a on a.id = l.appointment_id
        where a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}) as labor,
      (select coalesce(sum(j.supplies_cents),0)::int from job_records j join appointments a on a.id = j.appointment_id
        where a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}) as job_supplies,
      (select coalesce(sum(j.other_cost_cents),0)::int from job_records j join appointments a on a.id = j.appointment_id
        where a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}) as job_other,
      (select coalesce(sum(amount_cents),0)::int from expenses where not is_estimate and spent_on >= ${r.from}::date and spent_on < ${r.to}::date) as expenses,
      (select coalesce(sum(amount_cents),0)::int from expenses where is_estimate and spent_on >= ${r.from}::date and spent_on < ${r.to}::date) as est_expenses,
      (select count(*)::int from appointments where status = 'completed' and starts_at >= ${r.from} and starts_at < ${r.to}) as completed_jobs,
      (select count(*)::int from appointments where status = 'confirmed' and starts_at >= ${r.from} and starts_at < ${r.to}) as upcoming_unfinished`;
  // Estimated labor for confirmed jobs not yet completed (an estimate, kept separate from recorded labor).
  const upcoming = await sql<{ estimated_minutes: number; agreed_price_cents: number; crew: { pay_method: PayMethod; pay_rate_cents: number; pay_percent: number }[] }[]>`
    select a.estimated_minutes, a.agreed_price_cents,
           coalesce(json_agg(json_build_object('pay_method', c.pay_method, 'pay_rate_cents', c.pay_rate_cents, 'pay_percent', c.pay_percent))
                    filter (where c.id is not null), '[]') as crew
      from appointments a
      left join appointment_assignments aa on aa.appointment_id = a.id
      left join cleaners c on c.id = aa.cleaner_id
     where a.status = 'confirmed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}
     group by a.id`;
  const estimatedLabor = upcoming.reduce((s, u) => s + estimatedLaborCents(u.crew, u.estimated_minutes, u.agreed_price_cents), 0);
  const summary = periodSummary({
    completed_revenue_cents: row.completed_revenue,
    booked_revenue_cents: row.booked,
    labor_cents: row.labor,
    job_supplies_cents: row.job_supplies,
    job_other_cents: row.job_other,
    expenses_cents: row.expenses,
    estimated_expenses_cents: row.est_expenses,
  });
  const [bal] = await sql<{ outstanding: number; tracked: boolean }[]>`
    select coalesce(sum(greatest(j.revenue_cents - coalesce((select sum(p.amount_cents) from payments p where p.appointment_id = a.id),0), 0)),0)::int as outstanding,
           exists (select 1 from payments) as tracked
      from appointments a join job_records j on j.appointment_id = a.id
     where a.status = 'completed' and a.payment_status in ('unpaid','partial')`;
  return {
    ...summary,
    pending_value_cents: row.pending_value,
    estimated_upcoming_labor_cents: estimatedLabor,
    completed_jobs: row.completed_jobs,
    upcoming_confirmed_jobs: row.upcoming_unfinished,
    average_job_cents: row.completed_jobs ? Math.round(row.completed_revenue / row.completed_jobs) : null,
    outstanding_balance_cents: bal.outstanding,
    payments_tracked: bal.tracked,
  };
}

export type ApptListRow = {
  id: string; reference: string; status: string; starts_at: Date; ends_at: Date; service_slug: string; service_name: string;
  customer_id: string; customer_name: string; area: string | null; agreed_price_cents: number; estimated_minutes: number;
  cleaner_names: string[]; cleaner_ids: string[]; needs_attention: string | null; series_id: string | null; source: string; open_request: string | null;
};

export async function listAppointments(f: { from?: Date; to?: Date; status?: string[]; q?: string; cleanerId?: string; service?: string; area?: string; attention?: boolean; limit?: number; offset?: number }) {
  const sql = db();
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const digits = f.q?.replace(/\D/g, "") ?? "";
  const qd = digits.length >= 3 ? `%${digits}%` : null;
  const rows = await sql<ApptListRow[]>`
    select a.id, a.reference, a.status, a.starts_at, a.ends_at, a.service_slug, coalesce(s.name, a.service_slug) as service_name,
           a.customer_id, c.full_name as customer_name, sa.name as area, a.agreed_price_cents, a.estimated_minutes, a.needs_attention, a.series_id, a.source,
           coalesce(array_agg(cl.full_name order by cl.full_name) filter (where cl.id is not null), '{}') as cleaner_names,
           coalesce(array_agg(cl.id) filter (where cl.id is not null), '{}') as cleaner_ids,
           (select kind from customer_requests r where r.appointment_id = a.id and r.status = 'open' limit 1) as open_request
      from appointments a
      join customers c on c.id = a.customer_id
      join properties p on p.id = a.property_id
      left join service_areas sa on sa.id = p.service_area_id
      left join services s on s.slug = a.service_slug
      left join appointment_assignments aa on aa.appointment_id = a.id
      left join cleaners cl on cl.id = aa.cleaner_id
     where (${f.from ?? null}::timestamptz is null or a.ends_at > ${f.from ?? null})
       and (${f.to ?? null}::timestamptz is null or a.starts_at < ${f.to ?? null})
       and (${f.status ?? null}::text[] is null or a.status = any(${f.status ?? null}))
       and (${q}::text is null or lower(c.full_name) like ${q} or lower(a.reference) like ${q} or lower(coalesce(c.email,'')) like ${q} or (${qd}::text is not null and c.phone_digits like ${qd}))
       and (${f.service ?? null}::text is null or a.service_slug = ${f.service ?? null})
       and (${f.area ?? null}::uuid is null or p.service_area_id = ${f.area ?? null})
       and (${f.cleanerId ?? null}::uuid is null or exists (select 1 from appointment_assignments x where x.appointment_id = a.id and x.cleaner_id = ${f.cleanerId ?? null}))
       and (${f.attention ?? false} = false or a.needs_attention is not null or exists (select 1 from customer_requests r where r.appointment_id = a.id and r.status = 'open'))
     group by a.id, s.name, c.full_name, sa.name
     order by a.starts_at
     limit ${f.limit ?? 500} offset ${f.offset ?? 0}`;
  return Array.from(rows);
}

export async function getAppointmentDetail(id: string) {
  const sql = db();
  const [a] = await sql<{
    id: string; reference: string; status: string; starts_at: Date; ends_at: Date; service_slug: string; service_name: string; quote_id: string | null;
    series_id: string | null; occurrence_date: string | null; is_exception: boolean; source: string; frequency: string; agreed_price_cents: number;
    estimated_minutes: number; actual_minutes: number | null; addons: { label: string; quantity: number; amount_cents: number }[]; checklist: string[];
    internal_notes: string; customer_notes: string; access_instructions: string; scheduling_preferences: string; payment_status: string;
    needs_attention: string | null; cancelled_reason: string | null; created_at: Date;
    customer_id: string; customer_name: string; customer_email: string | null; customer_phone: string | null; preferred_contact: string;
    property_id: string; address: string; area: string | null; bedrooms: number | null; full_baths: number | null; half_baths: number; sqft: number | null; pets: string;
    property_access: string; quote_reference: string | null; quote_estimate_cents: number | null; quote_override_cents: number | null; quote_status: string | null;
  }[]>`
    select a.*, coalesce(s.name, a.service_slug) as service_name,
           c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, c.preferred_contact,
           p.id as property_id, concat_ws(', ', p.address_line1, p.unit, p.city, p.zip) as address, sa.name as area, p.bedrooms, p.full_baths, p.half_baths, p.sqft, p.pets,
           p.access_instructions as property_access, q.reference as quote_reference, q.estimate_cents as quote_estimate_cents, q.override_cents as quote_override_cents, q.status as quote_status
      from appointments a
      join customers c on c.id = a.customer_id
      join properties p on p.id = a.property_id
      left join service_areas sa on sa.id = p.service_area_id
      left join services s on s.slug = a.service_slug
      left join quotes q on q.id = a.quote_id
     where a.id = ${id}`;
  if (!a) return null;
  const [assignments, changes, comms, job, labor, requests, series, expenses] = await Promise.all([
    sql<{ cleaner_id: string; full_name: string; color: string; pay_method: PayMethod; pay_rate_cents: number; pay_percent: number }[]>`
      select c.id as cleaner_id, c.full_name, c.color, c.pay_method, c.pay_rate_cents, c.pay_percent::float as pay_percent
        from appointment_assignments aa join cleaners c on c.id = aa.cleaner_id where aa.appointment_id = ${id} order by c.full_name`,
    sql<{ id: string; kind: string; from_value: unknown; to_value: unknown; note: string; actor_label: string; created_at: Date }[]>`
      select id, kind, from_value, to_value, note, actor_label, created_at from appointment_changes where appointment_id = ${id} order by created_at desc`,
    sql<{ id: string; template: string; recipient: string; subject: string; status: string; error: string | null; created_at: Date; attempts: number }[]>`
      select id, template, recipient, subject, status, error, created_at, attempts from communications where appointment_id = ${id} order by created_at desc`,
    sql<{ revenue_cents: number; supplies_cents: number; other_cost_cents: number; notes: string; checklist_done: string[]; completed_at: Date }[]>`
      select revenue_cents, supplies_cents, other_cost_cents, notes, checklist_done, completed_at from job_records where appointment_id = ${id}`,
    sql<{ cleaner_id: string; full_name: string; minutes: number; pay_cents: number; pay_basis: string; clock_in: Date | null; clock_out: Date | null }[]>`
      select l.cleaner_id, c.full_name, l.minutes, l.pay_cents, l.pay_basis, l.clock_in, l.clock_out from labor_records l join cleaners c on c.id = l.cleaner_id where l.appointment_id = ${id}`,
    sql<{ id: string; kind: string; requested_starts_at: Date | null; message: string; status: string; created_at: Date }[]>`
      select id, kind, requested_starts_at, message, status, created_at from customer_requests where appointment_id = ${id} order by created_at desc`,
    a.series_id
      ? sql<{ id: string; frequency: string; interval_days: number | null; status: string; price_cents: number; start_time: string; duration_minutes: number; cleaner_ids: string[]; anchor_date: string }[]>`
          select id, frequency, interval_days, status, price_cents, start_time::text, duration_minutes, cleaner_ids, anchor_date from recurring_series where id = ${a.series_id}`
      : Promise.resolve([]),
    sql<{ id: string; category: string; amount_cents: number; description: string }[]>`select id, category, amount_cents, description from expenses where appointment_id = ${id}`,
  ]);
  const laborCents = labor.reduce((s, l) => s + l.pay_cents, 0);
  const profit = job[0]
    ? jobProfit({ revenue_cents: job[0].revenue_cents, labor_cents: laborCents, supplies_cents: job[0].supplies_cents, other_cost_cents: job[0].other_cost_cents })
    : null;
  return {
    a: { ...a }, assignments: Array.from(assignments), changes: Array.from(changes), comms: Array.from(comms), job: job[0] ?? null, labor: Array.from(labor), laborCents, profit, requests: Array.from(requests), series: series[0] ?? null, expenses: Array.from(expenses),
    estimatedLabor: estimatedLaborCents(assignments, a.estimated_minutes, a.agreed_price_cents),
  };
}

export async function customerFinancials(customerId: string) {
  const [row] = await db()<{ completed_revenue: number; labor: number; supplies: number; other: number; paid: number; completed_count: number }[]>`
    select coalesce(sum(j.revenue_cents),0)::int as completed_revenue,
           coalesce(sum((select sum(l.pay_cents) from labor_records l where l.appointment_id = a.id)),0)::int as labor,
           coalesce(sum(j.supplies_cents),0)::int as supplies, coalesce(sum(j.other_cost_cents),0)::int as other,
           (select coalesce(sum(amount_cents),0)::int from payments where customer_id = ${customerId}) as paid,
           count(j.*)::int as completed_count
      from appointments a join job_records j on j.appointment_id = a.id
     where a.customer_id = ${customerId} and a.status = 'completed'`;
  const series = await db()<{ frequency: string; price_cents: number; interval_days: number | null }[]>`
    select frequency, price_cents, interval_days from recurring_series where customer_id = ${customerId} and status = 'active'`;
  const projection = series.reduce((s, x) => s + monthlyRecurringProjection(x.frequency, x.price_cents, x.interval_days), 0);
  return { ...row, recurring_monthly_projection_cents: projection, profit: jobProfit({ revenue_cents: row.completed_revenue, labor_cents: row.labor, supplies_cents: row.supplies, other_cost_cents: row.other }) };
}

/** Lookups for staff forms: active services (with default length), active cleaners, areas. */
export async function staffFormOptions() {
  const sql = db();
  const [services, cleaners, areas, published] = await Promise.all([
    sql<{ slug: string; name: string }[]>`select slug, name from services where active or slug = 'custom' order by sort, name`,
    sql<{ id: string; full_name: string; color: string }[]>`select id, full_name, color from cleaners where active order by full_name`,
    sql<{ id: string; name: string }[]>`select id, name from service_areas order by sort, name`,
    getPublishedPricing().catch(() => null),
  ]);
  return {
    services: services.map((s) => ({ slug: s.slug, name: s.name, default_minutes: published?.rules.services[s.slug]?.base_minutes ?? 180 })),
    cleaners: Array.from(cleaners).map((c) => ({ ...c })),
    areas: Array.from(areas).map((a) => ({ ...a })),
  };
}
