import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { ExpenseList } from "@/components/admin/ExpenseEditor";
import { RangePicker } from "@/components/admin/RangePicker";
import { Stat } from "@/components/admin/Stat";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { financeTotals } from "@/lib/server/admin-queries";
import { resolveRange } from "@/lib/server/ranges";
import { jobProfitRows, listExpenses, outstandingJobs } from "@/lib/server/reports";
import { getSettings } from "@/lib/server/settings";
import { formatDate } from "@/lib/time";

export const metadata = { title: "Revenue & Expenses" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requirePage("finance.view");
  const sp = await searchParams;
  const tz = (await getSettings()).booking.timezone;
  const range = resolveRange(sp, tz);
  const [t, jobs, expenses, outstanding] = await Promise.all([financeTotals(range), jobProfitRows(range), listExpenses(range), outstandingJobs()]);
  const q = `from=${range.fromISO}&to=${range.toISO}`;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Money" title="Revenue & Expenses" actions={<RangePicker current={range.key} fromISO={range.fromISO} toISO={range.toISO} />}>
        <p className="mt-1 text-sm text-muted">{range.label}</p>
      </PageHeader>

      <section aria-label="Earned">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-muted">Earned (completed jobs)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Completed revenue" value={formatCents(t.completed_revenue_cents)} tone="gold" note={`${t.completed_jobs} job${t.completed_jobs === 1 ? "" : "s"}${t.average_job_cents ? ` · avg ${formatCents(t.average_job_cents)}` : ""}`} />
          <Stat label="Direct costs" value={formatCents(t.direct_cost_cents)} note={`Labor ${formatCents(t.labor_cents)} · supplies/other ${formatCents(t.job_supplies_cents + t.job_other_cents)}`} />
          <Stat label="Gross profit" value={formatCents(t.gross_profit_cents)} note="Revenue minus job costs" />
          <Stat label="Operating profit" value={formatCents(t.operating_profit_cents)} tone="gold" note={`After ${formatCents(t.expenses_cents)} business expenses${t.operating_margin_pct !== null ? ` · ${t.operating_margin_pct}%` : ""}`} />
        </div>
      </section>
      <section aria-label="Expected">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-muted">Expected (not earned yet)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Booked" value={formatCents(t.booked_revenue_cents)} note="Agreed price, confirmed + completed" />
          <Stat label="Pending requests" value={formatCents(t.pending_value_cents)} tone="estimate" note="Estimates awaiting review" />
          <Stat label="Upcoming labor" value={formatCents(t.estimated_upcoming_labor_cents)} tone="estimate" note={`${t.upcoming_confirmed_jobs} confirmed jobs`} />
          <Stat label="Estimated expenses" value={formatCents(t.estimated_expenses_cents)} tone="estimate" note="Not subtracted from profit" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-semibold">Job profitability</h2>
            <a className="btn btn-ghost btn-sm" href={`/api/admin/export/jobs?${q}`}><Download className="size-4" aria-hidden />CSV</a>
          </div>
          {jobs.length === 0 ? <p className="mt-2 text-sm text-muted">No completed jobs in this period. Complete a job (with its amount charged) to see profit here.</p> : (
            <div className="mt-3 overflow-x-auto"><table className="table">
              <thead><tr><th>Date</th><th>Customer</th><th className="text-right">Revenue</th><th className="text-right">Labor</th><th className="text-right">Supplies/other</th><th className="text-right">Profit</th></tr></thead>
              <tbody>{jobs.map((j) => (
                <tr key={j.id}>
                  <td className="whitespace-nowrap text-sm"><Link href={`/admin/appointments/${j.id}`} className="hover:text-gold-ink">{formatDate(j.starts_at, tz)}</Link></td>
                  <td className="text-sm">{j.customer}<span className="block text-xs text-muted">{j.service}{j.cleaners ? ` · ${j.cleaners}` : ""}</span></td>
                  <td className="text-right tabular-nums">{formatCents(j.revenue_cents)}</td>
                  <td className="text-right tabular-nums">{formatCents(j.labor_cents)}</td>
                  <td className="text-right tabular-nums">{formatCents(j.supplies_cents + j.other_cents)}</td>
                  <td className={`text-right font-semibold tabular-nums ${j.profit_cents < 0 ? "text-danger" : ""}`}>{formatCents(j.profit_cents)}{j.margin_pct !== null && <span className="block text-xs font-normal text-muted">{j.margin_pct}%</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <div className="space-y-6">
          <section className="card p-5">
            {can(user.role, "finance.edit") ? <ExpenseList items={expenses} /> : null}
            <a className="btn btn-ghost btn-sm mt-2" href={`/api/admin/export/expenses?${q}`}><Download className="size-4" aria-hidden />Expenses CSV</a>
          </section>
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Unpaid & partly paid</h2>
            <p className="text-xs text-muted">Completed jobs. Record payments from the customer&apos;s profile.</p>
            {outstanding.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing outstanding.</p> : (
              <ul className="mt-2 divide-y divide-line text-sm">{outstanding.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2"><Link href={`/admin/customers/${o.customer_id}`} className="hover:text-gold-ink">{o.customer}<span className="block text-xs text-muted">{formatDate(o.starts_at, tz)} · {o.payment_status}</span></Link><span className="tabular-nums font-semibold">{formatCents(Math.max(0, o.revenue_cents - o.paid_cents))}</span></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
