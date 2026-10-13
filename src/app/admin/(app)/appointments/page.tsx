import Link from "next/link";
import { DateTime } from "luxon";
import { CalendarPlus, Repeat } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePage } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { listAppointments, staffFormOptions } from "@/lib/server/admin-queries";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime, minutesLabel } from "@/lib/time";

export const metadata = { title: "Appointments" };

const TABS = [
  { key: "attention", label: "Needs attention" },
  { key: "pending", label: "Pending" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;
const PAGE = 50;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("schedule.view");
  const sp = await searchParams;
  const settings = await getSettings();
  const tz = settings.booking.timezone;
  const tab = (TABS.find((t) => t.key === sp.status)?.key ?? (sp.status === "confirmed" ? "upcoming" : "upcoming")) as (typeof TABS)[number]["key"];
  const page = Math.max(1, Number(sp.page) || 1);
  const now = DateTime.now().toJSDate();
  const filter: Parameters<typeof listAppointments>[0] = { q: sp.q, cleanerId: sp.cleaner || undefined, service: sp.service || undefined, limit: PAGE + 1, offset: (page - 1) * PAGE };
  if (tab === "attention") Object.assign(filter, { attention: true, status: ["pending", "confirmed"], from: DateTime.now().minus({ days: 2 }).toJSDate() });
  if (tab === "pending") Object.assign(filter, { status: ["pending"] });
  if (tab === "upcoming") Object.assign(filter, { status: ["pending", "confirmed"], from: now });
  if (tab === "past") Object.assign(filter, { status: ["confirmed", "completed", "no_show"], to: now });
  if (tab === "cancelled") Object.assign(filter, { status: ["cancelled", "declined"] });
  const [rows, opts] = await Promise.all([listAppointments(filter), staffFormOptions()]);
  if (tab === "past" || tab === "cancelled" || tab === "all") rows.reverse();
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: tab, q: sp.q, cleaner: sp.cleaner, service: sp.service, ...o })) if (v) p.set(k, String(v));
    return `?${p}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Schedule" title="Appointments" actions={<Link href="/admin/calendar?new=1" className="btn btn-primary"><CalendarPlus className="size-4" aria-hidden />New appointment</Link>} />
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Filter by status">
        {TABS.map((t) => (
          <Link key={t.key} href={qs({ status: t.key, page: undefined })} aria-current={tab === t.key ? "page" : undefined} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${tab === t.key ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white hover:border-gold"}`}>{t.label}</Link>
        ))}
      </nav>
      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" action="">
        <input type="hidden" name="status" value={tab} />
        <label className="sr-only" htmlFor="q">Search</label>
        <input id="q" name="q" className="input" placeholder="Search customer, phone, email or reference" defaultValue={sp.q ?? ""} />
        <select name="cleaner" className="input" defaultValue={sp.cleaner ?? ""} aria-label="Cleaner"><option value="">All cleaners</option>{opts.cleaners.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select>
        <select name="service" className="input" defaultValue={sp.service ?? ""} aria-label="Service"><option value="">All services</option>{opts.services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
        <button className="btn btn-dark" type="submit">Search</button>
      </form>

      {list.length === 0 ? (
        <EmptyState title="No appointments here">{sp.q ? "Try a different search." : "Appointments you create or receive online appear here."}</EmptyState>
      ) : (
        <>
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Cleaners</th><th className="text-right">Price</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap"><Link href={`/admin/appointments/${a.id}`} className="font-semibold hover:text-gold-ink">{formatDateTime(a.starts_at, tz)}</Link><span className="block text-xs text-muted">{minutesLabel(a.estimated_minutes)} · {a.reference}</span></td>
                    <td><Link href={`/admin/customers/${a.customer_id}`} className="hover:text-gold-ink">{a.customer_name}</Link>{a.area && <span className="block text-xs text-muted">{a.area}</span>}</td>
                    <td>{a.service_name}{a.series_id && <Repeat className="ml-1 inline size-3.5 text-gold" aria-label="Recurring" />}</td>
                    <td className={a.cleaner_names.length ? "" : "text-status-pending"}>{a.cleaner_names.join(", ") || "Unassigned"}</td>
                    <td className="text-right tabular-nums">{formatCents(a.agreed_price_cents)}</td>
                    <td><StatusBadge status={a.status} />{(a.needs_attention || a.open_request) && <span className="mt-1 block max-w-48 text-xs font-semibold text-status-pending">{a.open_request ? `Customer ${a.open_request} request` : a.needs_attention}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/appointments/${a.id}`} className="card block p-4">
                  <span className="flex items-start justify-between gap-2"><span className="font-semibold">{a.customer_name}</span><StatusBadge status={a.status} /></span>
                  <span className="mt-1 block text-sm">{formatDateTime(a.starts_at, tz)} <span className="text-xs text-muted">· {a.reference}</span></span>
                  <span className="block text-xs text-muted">{a.service_name} · {formatCents(a.agreed_price_cents)} · {a.cleaner_names.join(", ") || "Unassigned"}</span>
                  {(a.needs_attention || a.open_request) && <span className="mt-1 block text-xs font-semibold text-status-pending">{a.open_request ? `Customer ${a.open_request} request` : a.needs_attention}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex justify-between">
            {page > 1 ? <Link className="btn btn-outline btn-sm" href={qs({ page: page - 1 })}>← Previous</Link> : <span />}
            {more && <Link className="btn btn-outline btn-sm" href={qs({ page: page + 1 })}>Next →</Link>}
          </div>
        </>
      )}
    </div>
  );
}
