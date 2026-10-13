import Link from "next/link";
import { PageHeader } from "@/components/admin/AdminShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePage } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/pricing/rules";
import { listQuotes } from "@/lib/server/quotes-admin";
import { getSettings } from "@/lib/server/settings";
import { formatDate } from "@/lib/time";

export const metadata = { title: "Quotes" };
const TABS = [["draft", "Needs review"], ["pending_customer", "Awaiting customer"], ["sent", "Sent"], ["accepted", "Accepted"], ["declined", "Declined"], ["expired", "Expired"], ["all", "All"]] as const;
const PAGE = 50;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePage("quotes.view");
  const sp = await searchParams;
  const tz = (await getSettings()).booking.timezone;
  const status = TABS.some(([k]) => k === sp.status) ? sp.status! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const rows = await listQuotes({ status, q: sp.q, limit: PAGE + 1, offset: (page - 1) * PAGE });
  const list = rows.slice(0, PAGE);
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, q: sp.q, ...o })) if (v) p.set(k, String(v));
    return `?${p}`;
  };
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Sales" title="Quotes" actions={<Link href="/admin/quotes/new" className="btn btn-primary">New quote</Link>} />
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Filter by status">
        {TABS.map(([k, l]) => <Link key={k} href={qs({ status: k, page: undefined })} aria-current={status === k ? "page" : undefined} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${status === k ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white hover:border-gold"}`}>{l}</Link>)}
      </nav>
      <form className="flex gap-3" action=""><input type="hidden" name="status" value={status} /><label className="sr-only" htmlFor="qq">Search</label><input id="qq" name="q" className="input" placeholder="Search reference, customer or email" defaultValue={sp.q ?? ""} /><button className="btn btn-dark">Search</button></form>
      {list.length === 0 ? <EmptyState title="No quotes here">Quotes from the website and ones you create appear here.</EmptyState> : (
        <>
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead><tr><th>Quote</th><th>Customer</th><th>Service</th><th className="text-right">Amount</th><th>Created</th><th>Expires</th><th>Status</th></tr></thead>
              <tbody>{list.map((q) => (
                <tr key={q.id}>
                  <td><Link href={`/admin/quotes/${q.id}`} className="font-mono text-sm font-semibold hover:text-gold-ink">{q.reference}</Link><span className="block text-xs text-muted">{q.source === "website" ? "Website" : "Staff"}{q.requires_review ? " · review flagged" : ""}</span></td>
                  <td>{q.customer_name ?? "—"}</td>
                  <td className="text-sm">{q.service_name}<span className="block text-xs text-muted">{FREQUENCY_LABELS[q.frequency as Frequency] ?? q.frequency}</span></td>
                  <td className="text-right tabular-nums">{formatCents(q.override_cents ?? q.estimate_cents)}{q.override_cents !== null && <span className="block text-xs text-muted">calc {formatCents(q.estimate_cents)}</span>}</td>
                  <td className="text-sm">{formatDate(q.created_at, tz)}</td>
                  <td className="text-sm">{q.expires_at ? formatDate(q.expires_at, tz) : "—"}</td>
                  <td><StatusBadge status={q.status} />{q.has_appointment && <span className="block text-xs text-muted">Booked</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">{list.map((q) => (
            <li key={q.id}><Link href={`/admin/quotes/${q.id}`} className="card block p-4">
              <span className="flex items-start justify-between gap-2"><span className="font-semibold">{q.customer_name ?? q.reference}</span><StatusBadge status={q.status} /></span>
              <span className="block text-xs text-muted">{q.reference} · {q.service_name} · {formatCents(q.override_cents ?? q.estimate_cents)}</span>
            </Link></li>
          ))}</ul>
          <div className="flex justify-between">{page > 1 ? <Link className="btn btn-outline btn-sm" href={qs({ page: page - 1 })}>← Previous</Link> : <span />}{rows.length > PAGE && <Link className="btn btn-outline btn-sm" href={qs({ page: page + 1 })}>Next →</Link>}</div>
        </>
      )}
    </div>
  );
}
