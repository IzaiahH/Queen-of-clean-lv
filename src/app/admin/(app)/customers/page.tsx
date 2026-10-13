import Link from "next/link";
import { PageHeader } from "@/components/admin/AdminShell";
import { NewCustomerButton } from "@/components/admin/CustomerForms";
import { ContactMessageActions } from "@/components/admin/CustomerWidgets";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { frequencyLabel } from "@/lib/scheduling/recurrence";
import { listCustomers } from "@/lib/server/customers";
import { getSettings } from "@/lib/server/settings";
import { formatDate, formatDateTime } from "@/lib/time";

export const metadata = { title: "Customers" };
const PAGE = 50;
const STATUSES = [["", "Current"], ["active", "Active"], ["lead", "Leads"], ["inactive", "Inactive"], ["archived", "Archived"], ["all", "All"]] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePage("customers.view");
  const sp = await searchParams;
  const tz = (await getSettings()).booking.timezone;
  const showMoney = can(user.role, "finance.view");
  const [{ n: newMessages }] = await db()<{ n: number }[]>`select count(*)::int as n from contact_messages where status = 'new'`;
  const tabs = (
    <nav className="flex gap-1" aria-label="Customer sections">
      <Link href="/admin/customers" aria-current={sp.tab !== "messages" ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm font-semibold ${sp.tab !== "messages" ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white"}`}>Customers</Link>
      <Link href="/admin/customers?tab=messages" aria-current={sp.tab === "messages" ? "page" : undefined} className={`rounded-full border px-4 py-2 text-sm font-semibold ${sp.tab === "messages" ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white"}`}>Website messages{newMessages ? ` (${newMessages})` : ""}</Link>
    </nav>
  );

  if (sp.tab === "messages") {
    const msgs = await db()<{ id: string; name: string; email: string; phone: string | null; message: string; status: string; created_at: Date }[]>`
      select id, name, email, phone, message, status, created_at from contact_messages order by (status = 'new') desc, created_at desc limit 200`;
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="CRM" title="Customers" actions={<NewCustomerButton />} />
        {tabs}
        {msgs.length === 0 ? <EmptyState title="No messages yet">Messages sent from the website contact form appear here.</EmptyState> : (
          <ul className="space-y-3">
            {msgs.map((m) => (
              <li key={m.id} className={`card p-4 ${m.status === "new" ? "border-gold" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-semibold">{m.name}</p><p className="text-xs text-muted">{m.email}{m.phone ? ` · ${m.phone}` : ""} · {formatDateTime(m.created_at, tz)}</p></div>
                  <StatusBadge status={m.status === "new" ? "pending" : m.status === "spam" ? "cancelled" : "completed"} label={m.status === "new" ? "New" : m.status === "spam" ? "Spam" : "Handled"} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{m.message}</p>
                <div className="mt-3"><ContactMessageActions id={m.id} status={m.status} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const rows = await listCustomers({ q: sp.q, status: sp.status, sort: sp.sort, limit: PAGE + 1, offset: (page - 1) * PAGE });
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, sort: sp.sort, ...o })) if (v) p.set(k, String(v));
    return `?${p}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="CRM" title="Customers" actions={<><Link href="/admin/import-export" className="btn btn-outline">Import</Link><NewCustomerButton initiallyOpen={sp.new === "1"} /></>} />
      {tabs}
      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" action="">
        <label className="sr-only" htmlFor="cq">Search</label>
        <input id="cq" name="q" className="input" placeholder="Search name, email, phone or street" defaultValue={sp.q ?? ""} />
        <select name="status" className="input" defaultValue={sp.status ?? ""} aria-label="Status">{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select name="sort" className="input" defaultValue={sp.sort ?? "name"} aria-label="Sort">
          <option value="name">Name A–Z</option><option value="recent">Newest first</option><option value="last_visit">Last visit</option>{showMoney && <option value="value">Lifetime value</option>}
        </select>
        <button className="btn btn-dark" type="submit">Search</button>
      </form>

      {list.length === 0 ? (
        <EmptyState title={sp.q ? "No customers match" : "No customers yet"} action={!sp.q ? <Link href="/admin/import-export" className="btn btn-outline">Import a spreadsheet</Link> : undefined}>
          {sp.q ? "Try a shorter search, a phone number, or a different status." : "Add customers one at a time or import your existing list."}
        </EmptyState>
      ) : (
        <>
          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead><tr><th>Name</th><th>Contact</th><th>Area</th><th>Recurring</th><th>Last visit</th><th>Next visit</th>{showMoney && <th className="text-right">Lifetime</th>}<th>Status</th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/admin/customers/${c.id}`} className="font-semibold hover:text-gold-ink">{c.full_name}</Link></td>
                    <td className="text-xs">{c.email ?? "—"}<span className="block text-muted">{c.phone ?? ""}</span></td>
                    <td className="text-sm">{c.area ?? c.city ?? "—"}</td>
                    <td className="text-sm">{c.recurring ? frequencyLabel(c.recurring as "weekly") : "—"}</td>
                    <td className="text-sm">{c.last_visit ? formatDate(c.last_visit, tz) : "—"}</td>
                    <td className="text-sm">{c.next_visit ? formatDate(c.next_visit, tz) : "—"}</td>
                    {showMoney && <td className="text-right tabular-nums">{formatCents(c.lifetime_cents)}</td>}
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {list.map((c) => (
              <li key={c.id}><Link href={`/admin/customers/${c.id}`} className="card block p-4">
                <span className="flex items-start justify-between gap-2"><span className="font-semibold">{c.full_name}</span><StatusBadge status={c.status} /></span>
                <span className="block text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                <span className="mt-1 block text-xs">{c.next_visit ? `Next: ${formatDate(c.next_visit, tz)}` : c.last_visit ? `Last: ${formatDate(c.last_visit, tz)}` : "No visits yet"}{c.recurring ? " · Recurring" : ""}</span>
              </Link></li>
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
