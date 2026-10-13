import Link from "next/link";
import { DateTime } from "luxon";
import { AlertTriangle, CalendarPlus, Repeat } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { RangePicker } from "@/components/admin/RangePicker";
import { Stat } from "@/components/admin/Stat";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { financeTotals, listAppointments } from "@/lib/server/admin-queries";
import { resolveRange } from "@/lib/server/ranges";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime, formatTime, minutesLabel } from "@/lib/time";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requirePage("dashboard.view");
  const sp = await searchParams;
  const settings = await getSettings();
  const tz = settings.booking.timezone;
  const range = resolveRange(sp, tz);
  const now = DateTime.now().setZone(tz);
  const showMoney = can(user.role, "finance.view");

  const [today, attention, upcomingRecurring, counts, cleanersCount, money] = await Promise.all([
    listAppointments({ from: now.startOf("day").toJSDate(), to: now.endOf("day").toJSDate(), status: ["pending", "confirmed", "completed"] }),
    listAppointments({ from: now.minus({ days: 1 }).toJSDate(), status: ["pending", "confirmed"], attention: true, limit: 20 }),
    listAppointments({ from: now.toJSDate(), to: now.plus({ days: 7 }).toJSDate(), status: ["confirmed", "pending"], limit: 50 }).then((r) => r.filter((x) => x.series_id)),
    db()<{ pending: number; drafts: number; upcoming: number; unassigned: number }[]>`
      select (select count(*)::int from appointments where status = 'pending' and starts_at > now()) as pending,
             (select count(*)::int from quotes where status = 'draft') as drafts,
             (select count(*)::int from appointments where status = 'confirmed' and starts_at between now() and now() + interval '7 days') as upcoming,
             (select count(*)::int from appointments a where status in ('pending','confirmed') and starts_at > now()
                and not exists (select 1 from appointment_assignments x where x.appointment_id = a.id)) as unassigned`,
    db()<{ n: number }[]>`select count(*)::int as n from cleaners where active`,
    showMoney ? financeTotals(range) : Promise.resolve(null),
  ]);
  const c = counts[0];
  const pendingList = attention.concat((await listAppointments({ from: now.toJSDate(), status: ["pending"], limit: 10 })).filter((p) => !attention.some((a) => a.id === p.id)));

  return (
    <div className="space-y-8">
      <PageHeader eyebrow={now.toFormat("cccc, LLLL d")} title={`Good ${now.hour < 12 ? "morning" : now.hour < 17 ? "afternoon" : "evening"}, ${user.full_name.split(" ")[0]}`}
        actions={<><Link href="/admin/calendar?new=1" className="btn btn-primary"><CalendarPlus className="size-4" aria-hidden />New appointment</Link><Link href="/admin/calendar" className="btn btn-outline">Open calendar</Link></>} />

      {cleanersCount[0].n === 0 && (
        <div className="card flex flex-col gap-3 border-gold p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">Add a cleaner to open online booking</p><p className="text-sm text-muted">Customers only see times when at least one active cleaner has working hours. Add yourself first if you do the cleaning.</p></div>
          <Link href="/admin/cleaners" className="btn btn-dark btn-sm">Add a cleaner</Link>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's jobs" value={today.length} note={today.length ? `${today.filter((t) => t.status === "completed").length} completed` : "Nothing scheduled"} href="/admin/calendar?view=day" />
        <Stat label="Pending requests" value={c.pending} tone={c.pending ? "warn" : "default"} note="Awaiting your review" href="/admin/appointments?status=pending" />
        <Stat label="Quotes to review" value={c.drafts} tone={c.drafts ? "warn" : "default"} note="Need a price check" href="/admin/quotes?status=draft" />
        <Stat label="Next 7 days" value={c.upcoming} note={c.unassigned ? `${c.unassigned} without a cleaner` : "Confirmed jobs"} href="/admin/appointments?status=confirmed" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <section className="card p-5">
          <div className="flex items-center justify-between"><h2 className="text-2xl font-semibold">Today</h2><Link href="/admin/calendar?view=day" className="text-sm font-semibold text-gold-ink">Day view →</Link></div>
          {today.length === 0 ? <p className="mt-3 text-sm text-muted">No jobs today.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {today.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/appointments/${a.id}`} className="flex items-center gap-4 py-3 hover:bg-cream/40">
                    <span className="w-20 shrink-0 text-sm font-bold">{formatTime(a.starts_at, tz)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.customer_name}</span>
                      <span className="block truncate text-xs text-muted">{a.service_name} · {minutesLabel(a.estimated_minutes)} · {a.cleaner_names.join(", ") || "No cleaner assigned"}</span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="flex items-center gap-2 text-2xl font-semibold"><AlertTriangle className="size-5 text-status-pending" aria-hidden />Needs attention</h2>
          {pendingList.length === 0 ? <p className="mt-3 text-sm text-muted">All caught up.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {pendingList.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/appointments/${a.id}`} className="block py-3 hover:bg-cream/40">
                    <span className="flex items-center justify-between gap-2"><span className="font-semibold">{a.customer_name}</span><StatusBadge status={a.status} /></span>
                    <span className="block text-xs text-muted">{formatDateTime(a.starts_at, tz)} · {a.service_name}</span>
                    {(a.needs_attention || a.open_request) && <span className="mt-1 block text-xs font-semibold text-status-pending">{a.open_request ? `Customer ${a.open_request} request` : a.needs_attention}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-2xl font-semibold"><Repeat className="size-5 text-gold" aria-hidden />Recurring cleans this week</h2>
        {upcomingRecurring.length === 0 ? <p className="mt-3 text-sm text-muted">No recurring visits in the next 7 days.</p> : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingRecurring.map((a) => (
              <li key={a.id}><Link href={`/admin/appointments/${a.id}`} className="block rounded-[var(--radius-control)] border border-line p-3 text-sm hover:border-gold"><span className="font-semibold">{a.customer_name}</span><span className="block text-xs text-muted">{formatDateTime(a.starts_at, tz)}{a.cleaner_names.length ? ` · ${a.cleaner_names.join(", ")}` : ""}</span></Link></li>
            ))}
          </ul>
        )}
      </section>

      {money && (
        <section>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-2xl font-semibold">Money</h2><p className="text-sm text-muted">{range.label}</p></div>
            <RangePicker current={range.key} fromISO={range.fromISO} toISO={range.toISO} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Completed revenue" value={formatCents(money.completed_revenue_cents)} tone="gold" note={`Earned · ${money.completed_jobs} completed job${money.completed_jobs === 1 ? "" : "s"}`} />
            <Stat label="Booked revenue" value={formatCents(money.booked_revenue_cents)} note="Confirmed + completed jobs (not all earned yet)" />
            <Stat label="Pending requests value" value={formatCents(money.pending_value_cents)} tone="estimate" note="Estimates only — not revenue" />
            <Stat label="Operating profit" value={formatCents(money.operating_profit_cents)} tone="gold" note={money.operating_margin_pct !== null ? `${money.operating_margin_pct}% of completed revenue · recorded costs only` : "Recorded costs only"} />
            <Stat label="Cleaner labor (recorded)" value={formatCents(money.labor_cents)} note="From completed jobs" />
            <Stat label="Labor (estimated, upcoming)" value={formatCents(money.estimated_upcoming_labor_cents)} tone="estimate" note="Confirmed jobs not yet done" />
            <Stat label="Supplies & expenses" value={formatCents(money.job_supplies_cents + money.job_other_cents + money.expenses_cents)} note={money.estimated_expenses_cents ? `+ ${formatCents(money.estimated_expenses_cents)} estimated (excluded)` : "Recorded"} />
            <Stat label="Outstanding balances" value={money.payments_tracked ? formatCents(money.outstanding_balance_cents) : "Not tracked"} note={money.payments_tracked ? "Completed jobs not fully paid" : "Record payments on a job to track"} />
          </div>
        </section>
      )}

      {today.length === 0 && pendingList.length === 0 && c.upcoming === 0 && (
        <EmptyState title="Your calendar is clear" action={<Link href="/admin/customers?new=1" className="btn btn-dark">Add a customer</Link>}>Add your existing customers or import your spreadsheet, then book their next cleaning from their profile.</EmptyState>
      )}
    </div>
  );
}
