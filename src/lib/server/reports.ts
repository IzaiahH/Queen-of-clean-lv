import "server-only";
import { db } from "@/lib/db";
import { monthlyRecurringProjection } from "@/lib/finance/calc";
import type { Range } from "./admin-queries";

/**
 * Report rows. Every revenue figure here is *completed* revenue (recorded on finished jobs);
 * "booked" is agreed price of confirmed/completed appointments, never mixed with earned revenue.
 */

/** One row per completed job in range with its direct costs — the base for job profitability. */
export async function jobProfitRows(r: Range) {
  const rows = await db()<{
    id: string; starts_at: Date; customer_id: string; customer: string; service: string; area: string | null; cleaners: string;
    revenue_cents: number; labor_cents: number; supplies_cents: number; other_cents: number; minutes: number; paid_cents: number; payment_status: string;
  }[]>`
    select a.id, a.starts_at, a.customer_id, c.full_name as customer, coalesce(s.name, a.service_slug) as service, sa.name as area,
           coalesce((select string_agg(cl.full_name, ', ' order by cl.full_name) from labor_records l join cleaners cl on cl.id = l.cleaner_id where l.appointment_id = a.id), '') as cleaners,
           j.revenue_cents, coalesce((select sum(pay_cents) from labor_records l where l.appointment_id = a.id),0)::int as labor_cents,
           j.supplies_cents, j.other_cost_cents as other_cents, coalesce(a.actual_minutes, a.estimated_minutes) as minutes,
           coalesce((select sum(amount_cents) from payments p where p.appointment_id = a.id),0)::int as paid_cents, a.payment_status
      from appointments a join job_records j on j.appointment_id = a.id join customers c on c.id = a.customer_id
      join properties p on p.id = a.property_id left join service_areas sa on sa.id = p.service_area_id left join services s on s.slug = a.service_slug
     where a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to}
     order by a.starts_at desc`;
  return Array.from(rows).map((x) => {
    const profit = x.revenue_cents - x.labor_cents - x.supplies_cents - x.other_cents;
    return { ...x, profit_cents: profit, margin_pct: x.revenue_cents ? Math.round((profit / x.revenue_cents) * 1000) / 10 : null };
  });
}

type Group = { key: string; jobs: number; revenue_cents: number; labor_cents: number; supplies_cents: number; other_cents: number; profit_cents: number; minutes: number };

function groupBy<T extends { revenue_cents: number; labor_cents: number; supplies_cents: number; other_cents: number; profit_cents: number; minutes: number }>(rows: T[], key: (r: T) => string): Group[] {
  const m = new Map<string, Group>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, jobs: 0, revenue_cents: 0, labor_cents: 0, supplies_cents: 0, other_cents: 0, profit_cents: 0, minutes: 0 };
    g.jobs++; g.revenue_cents += r.revenue_cents; g.labor_cents += r.labor_cents; g.supplies_cents += r.supplies_cents; g.other_cents += r.other_cents; g.profit_cents += r.profit_cents; g.minutes += r.minutes;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.revenue_cents - a.revenue_cents);
}

export async function reportByMonth(r: Range, tz: string) {
  const jobs = await jobProfitRows(r);
  const months = groupBy(jobs, (j) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(j.starts_at).slice(0, 7));
  const exp = await db()<{ month: string; amount: number }[]>`
    select to_char(spent_on, 'YYYY-MM') as month, sum(amount_cents)::int as amount from expenses
     where not is_estimate and spent_on >= ${r.from}::date and spent_on < ${r.to}::date group by 1`;
  const booked = await db()<{ month: string; amount: number; cancelled: number; total: number }[]>`
    select to_char(starts_at at time zone ${tz}, 'YYYY-MM') as month,
           coalesce(sum(agreed_price_cents) filter (where status in ('confirmed','completed')),0)::int as amount,
           count(*) filter (where status in ('cancelled','no_show'))::int as cancelled, count(*)::int as total
      from appointments where starts_at >= ${r.from} and starts_at < ${r.to} group by 1`;
  const keys = [...new Set([...months.map((x) => x.key), ...exp.map((x) => x.month), ...booked.map((x) => x.month)])].sort();
  return keys.map((k) => {
    const g = months.find((x) => x.key === k);
    const e = exp.find((x) => x.month === k)?.amount ?? 0;
    const b = booked.find((x) => x.month === k);
    return {
      key: k, jobs: g?.jobs ?? 0, revenue_cents: g?.revenue_cents ?? 0, booked_cents: b?.amount ?? 0, labor_cents: g?.labor_cents ?? 0,
      job_costs_cents: (g?.supplies_cents ?? 0) + (g?.other_cents ?? 0), expenses_cents: e, operating_profit_cents: (g?.profit_cents ?? 0) - e,
      cancellations: b?.cancelled ?? 0, appointments: b?.total ?? 0,
    };
  });
}

export async function reportByService(r: Range) { return groupBy(await jobProfitRows(r), (j) => j.service); }
export async function reportByArea(r: Range) { return groupBy(await jobProfitRows(r), (j) => j.area ?? "Outside listed areas"); }
export async function reportByCustomer(r: Range) {
  const rows = await jobProfitRows(r);
  return groupBy(rows, (j) => `${j.customer_id}|${j.customer}`).map((g) => ({ ...g, customer_id: g.key.split("|")[0], key: g.key.split("|").slice(1).join("|") }));
}

export async function reportByCleaner(r: Range) {
  const rows = await db()<{ id: string; name: string; jobs: number; minutes: number; pay_cents: number; revenue_share_cents: number; no_shows: number }[]>`
    select cl.id, cl.full_name as name, count(distinct l.appointment_id)::int as jobs, coalesce(sum(l.minutes),0)::int as minutes, coalesce(sum(l.pay_cents),0)::int as pay_cents,
           coalesce(sum(j.revenue_cents / greatest(1, (select count(*) from labor_records l2 where l2.appointment_id = l.appointment_id))),0)::int as revenue_share_cents,
           (select count(*)::int from appointment_assignments x join appointments a2 on a2.id = x.appointment_id where x.cleaner_id = cl.id and a2.status = 'no_show' and a2.starts_at >= ${r.from} and a2.starts_at < ${r.to}) as no_shows
      from cleaners cl
      left join labor_records l on l.cleaner_id = cl.id and exists (select 1 from appointments a where a.id = l.appointment_id and a.status = 'completed' and a.starts_at >= ${r.from} and a.starts_at < ${r.to})
      left join job_records j on j.appointment_id = l.appointment_id
     group by cl.id order by jobs desc, cl.full_name`;
  return Array.from(rows).map((x) => ({ ...x }));
}

export async function reportRetention(r: Range) {
  const [row] = await db()<{ new_customers: number; returning_customers: number; active_series: number; cancelled: number; no_show: number; total: number; leads: number; quotes: number; accepted: number }[]>`
    with done as (
      select a.customer_id, min(a.starts_at) over (partition by a.customer_id) as first_ever, a.starts_at
        from appointments a where a.status = 'completed'
    )
    select (select count(distinct customer_id)::int from done where starts_at >= ${r.from} and starts_at < ${r.to} and first_ever >= ${r.from}) as new_customers,
           (select count(distinct customer_id)::int from done where starts_at >= ${r.from} and starts_at < ${r.to} and first_ever < ${r.from}) as returning_customers,
           (select count(*)::int from recurring_series where status = 'active') as active_series,
           (select count(*)::int from appointments where status = 'cancelled' and starts_at >= ${r.from} and starts_at < ${r.to}) as cancelled,
           (select count(*)::int from appointments where status = 'no_show' and starts_at >= ${r.from} and starts_at < ${r.to}) as no_show,
           (select count(*)::int from appointments where starts_at >= ${r.from} and starts_at < ${r.to}) as total,
           (select count(*)::int from customers where status = 'lead') as leads,
           (select count(*)::int from quotes where created_at >= ${r.from} and created_at < ${r.to}) as quotes,
           (select count(*)::int from quotes where created_at >= ${r.from} and created_at < ${r.to} and status = 'accepted') as accepted`;
  const series = await db()<{ frequency: string; price_cents: number; interval_days: number | null }[]>`select frequency, price_cents, interval_days from recurring_series where status = 'active'`;
  return { ...row, recurring_monthly_projection_cents: series.reduce((s, x) => s + monthlyRecurringProjection(x.frequency, x.price_cents, x.interval_days), 0) };
}

export async function listExpenses(r: Range) {
  const rows = await db()<{ id: string; spent_on: string; category: string; amount_cents: number; description: string; is_estimate: boolean; appointment_id: string | null; appointment_ref: string | null }[]>`
    select e.id, e.spent_on::text, e.category, e.amount_cents, e.description, e.is_estimate, e.appointment_id, a.reference as appointment_ref
      from expenses e left join appointments a on a.id = e.appointment_id
     where e.spent_on >= ${r.from}::date and e.spent_on < ${r.to}::date order by e.spent_on desc, e.created_at desc`;
  return Array.from(rows).map((x) => ({ ...x }));
}

export async function outstandingJobs() {
  const rows = await db()<{ id: string; starts_at: Date; customer_id: string; customer: string; revenue_cents: number; paid_cents: number; payment_status: string }[]>`
    select a.id, a.starts_at, a.customer_id, c.full_name as customer, j.revenue_cents,
           coalesce((select sum(amount_cents) from payments p where p.appointment_id = a.id),0)::int as paid_cents, a.payment_status
      from appointments a join job_records j on j.appointment_id = a.id join customers c on c.id = a.customer_id
     where a.status = 'completed' and a.payment_status in ('unpaid','partial') order by a.starts_at desc limit 100`;
  return Array.from(rows).map((x) => ({ ...x }));
}
