import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { RangePicker } from "@/components/admin/RangePicker";
import { Stat } from "@/components/admin/Stat";
import { requirePage } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { resolveRange } from "@/lib/server/ranges";
import { reportByArea, reportByCleaner, reportByCustomer, reportByMonth, reportByService, reportRetention } from "@/lib/server/reports";
import { getSettings } from "@/lib/server/settings";
import { minutesLabel } from "@/lib/time";

export const metadata = { title: "Reports" };
const TABS = [["month", "By month"], ["service", "By service"], ["customer", "By customer"], ["cleaner", "By cleaner"], ["area", "By area"], ["retention", "Retention"]] as const;

function GroupTable({ rows, label }: { rows: { key: string; jobs: number; revenue_cents: number; labor_cents: number; supplies_cents: number; other_cents: number; profit_cents: number; minutes: number; customer_id?: string }[]; label: string }) {
  if (!rows.length) return <p className="text-sm text-muted">No completed jobs in this period.</p>;
  const total = rows.reduce((s, r) => s + r.revenue_cents, 0);
  return (
    <div className="overflow-x-auto"><table className="table">
      <thead><tr><th>{label}</th><th className="text-right">Jobs</th><th className="text-right">Revenue</th><th className="text-right">Share</th><th className="text-right">Avg job</th><th className="text-right">Labor</th><th className="text-right">Profit</th><th className="text-right">Hours</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key + (r.customer_id ?? "")}>
          <td className="font-semibold">{r.customer_id ? <Link href={`/admin/customers/${r.customer_id}`} className="hover:text-gold-ink">{r.key}</Link> : r.key}</td>
          <td className="text-right tabular-nums">{r.jobs}</td><td className="text-right tabular-nums">{formatCents(r.revenue_cents)}</td>
          <td className="text-right tabular-nums">{total ? Math.round((r.revenue_cents / total) * 100) : 0}%</td>
          <td className="text-right tabular-nums">{formatCents(Math.round(r.revenue_cents / Math.max(1, r.jobs)))}</td>
          <td className="text-right tabular-nums">{formatCents(r.labor_cents)}</td><td className="text-right font-semibold tabular-nums">{formatCents(r.profit_cents)}</td>
          <td className="text-right tabular-nums">{(r.minutes / 60).toFixed(1)}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePage("reports.view");
  const sp = await searchParams;
  const tz = (await getSettings()).booking.timezone;
  const range = resolveRange({ range: sp.range ?? "year", from: sp.from, to: sp.to }, tz);
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab : "month";
  const q = `from=${range.fromISO}&to=${range.toISO}`;
  const keep = (o: Record<string, string>) => `?${new URLSearchParams({ ...(sp.range ? { range: sp.range } : { range: "year" }), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...o })}`;

  let body: React.ReactNode = null;
  if (tab === "month") {
    const rows = await reportByMonth(range, tz);
    body = rows.length === 0 ? <p className="text-sm text-muted">No activity in this period.</p> : (
      <div className="overflow-x-auto"><table className="table">
        <thead><tr><th>Month</th><th className="text-right">Completed jobs</th><th className="text-right">Completed revenue</th><th className="text-right">Booked</th><th className="text-right">Labor</th><th className="text-right">Job costs</th><th className="text-right">Expenses</th><th className="text-right">Operating profit</th><th className="text-right">Cancel / no-show</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key}><td className="font-semibold">{r.key}</td><td className="text-right tabular-nums">{r.jobs}</td><td className="text-right tabular-nums">{formatCents(r.revenue_cents)}</td><td className="text-right tabular-nums text-muted">{formatCents(r.booked_cents)}</td><td className="text-right tabular-nums">{formatCents(r.labor_cents)}</td><td className="text-right tabular-nums">{formatCents(r.job_costs_cents)}</td><td className="text-right tabular-nums">{formatCents(r.expenses_cents)}</td><td className="text-right font-semibold tabular-nums">{formatCents(r.operating_profit_cents)}</td><td className="text-right tabular-nums">{r.cancellations}/{r.appointments}</td></tr>
        ))}</tbody>
      </table></div>
    );
  } else if (tab === "service") body = <GroupTable rows={await reportByService(range)} label="Service" />;
  else if (tab === "customer") body = <GroupTable rows={(await reportByCustomer(range)).slice(0, 200)} label="Customer" />;
  else if (tab === "area") body = <GroupTable rows={await reportByArea(range)} label="Area" />;
  else if (tab === "cleaner") {
    const rows = await reportByCleaner(range);
    body = (
      <div className="overflow-x-auto"><table className="table">
        <thead><tr><th>Cleaner</th><th className="text-right">Jobs</th><th className="text-right">Hours logged</th><th className="text-right">Pay recorded</th><th className="text-right">Revenue share</th><th className="text-right">No-shows</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="font-semibold"><Link href={`/admin/cleaners/${r.id}`} className="hover:text-gold-ink">{r.name}</Link></td><td className="text-right tabular-nums">{r.jobs}</td><td className="text-right tabular-nums">{minutesLabel(r.minutes)}</td><td className="text-right tabular-nums">{formatCents(r.pay_cents)}</td><td className="text-right tabular-nums">{formatCents(r.revenue_share_cents)}</td><td className="text-right tabular-nums">{r.no_shows}</td></tr>)}</tbody>
      </table><p className="mt-2 text-xs text-muted">Revenue share splits each job&apos;s revenue evenly between the cleaners who worked it.</p></div>
    );
  } else {
    const r = await reportRetention(range);
    body = (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New customers" value={r.new_customers} note="First completed visit in period" />
        <Stat label="Returning customers" value={r.returning_customers} note="Had visits before this period" />
        <Stat label="Active recurring" value={r.active_series} note={`${formatCents(r.recurring_monthly_projection_cents)}/mo projected`} tone="estimate" />
        <Stat label="Open leads" value={r.leads} />
        <Stat label="Cancellations" value={r.cancelled} note={r.total ? `${Math.round((r.cancelled / r.total) * 100)}% of ${r.total} appointments` : undefined} />
        <Stat label="No-shows" value={r.no_show} />
        <Stat label="Quotes created" value={r.quotes} />
        <Stat label="Quotes accepted" value={r.accepted} note={r.quotes ? `${Math.round((r.accepted / r.quotes) * 100)}% acceptance` : undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Money" title="Reports" actions={<RangePicker current={range.key} fromISO={range.fromISO} toISO={range.toISO} />}>
        <p className="mt-1 text-sm text-muted">{range.label} · Revenue = completed jobs only. Booked amounts are shown separately.</p>
      </PageHeader>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Report">
        {TABS.map(([k, l]) => <Link key={k} href={keep({ tab: k })} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white hover:border-gold"}`}>{l}</Link>)}
      </nav>
      <section className="card p-5">
        {tab !== "retention" && <div className="mb-3 flex justify-end"><a className="btn btn-ghost btn-sm" href={`/api/admin/export/report-${tab}?${q}`}><Download className="size-4" aria-hidden />Download CSV</a></div>}
        {body}
      </section>
    </div>
  );
}
