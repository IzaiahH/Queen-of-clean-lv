import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/AdminShell";
import { QuoteControls } from "@/components/admin/QuoteControls";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { CONDITION_LABELS, FREQUENCY_LABELS, type Condition, type Frequency } from "@/lib/pricing/rules";
import { staffFormOptions } from "@/lib/server/admin-queries";
import { getQuoteDetail } from "@/lib/server/quotes-admin";
import { getSettings } from "@/lib/server/settings";
import { formatDate, formatDateTime, minutesLabel } from "@/lib/time";

export const metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("quotes.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, opts, settings] = await Promise.all([getQuoteDetail(id), staffFormOptions(), getSettings()]);
  if (!d) notFound();
  const { q } = d;
  const tz = settings.booking.timezone;
  const customer = q.customer_id ? await db()<{ id: string; label: string; address: string; has_address: boolean }[]>`
    select id, label, concat_ws(', ', address_line1, unit, city) as address, address_line1 is not null as has_address from properties where customer_id = ${q.customer_id} order by is_primary desc`
    .then((props) => ({ id: q.customer_id!, full_name: q.customer_name ?? "", email: q.customer_email, phone: q.customer_phone, properties: Array.from(props).map((p) => ({ ...p })), last_price: null, last_minutes: null })) : null;
  const inputs = q.inputs as { bedrooms?: number; full_baths?: number; half_baths?: number; sqft?: number | null; condition?: Condition | null; pets?: number; area?: string | null; staff_notes?: string; special_requests?: string; recently_cleaned?: string };
  const amount = q.override_cents ?? q.estimate_cents;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={`Quote ${q.reference} · ${q.source === "website" ? "From website" : "Staff"}`} title={q.customer_name ?? "No customer"}>
        <div className="mt-2 flex flex-wrap items-center gap-3"><StatusBadge status={q.status} />{q.customer_id && <Link href={`/admin/customers/${q.customer_id}`} className="text-sm font-semibold text-gold-ink">Customer profile →</Link>}</div>
      </PageHeader>
      <QuoteControls q={{ ...q, has_appointment: d.appointments.length > 0 }} canOverride={can(user.role, "quotes.override")} customer={customer} tz={tz} services={opts.services} cleaners={opts.cleaners} />

      {q.requires_review && q.review_reasons.length > 0 && (
        <div className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-4 text-sm text-status-pending">
          <p className="font-semibold">Flagged for review</p><ul className="mt-1 list-disc pl-5">{q.review_reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-2xl font-semibold">Price</h2>
          <p className="mt-2 font-display text-4xl font-semibold text-gold-ink [font-variant-numeric:lining-nums]">{formatCents(amount)}</p>
          {q.breakdown.mode === "custom" && q.override_cents === null && <p className="text-sm font-semibold text-status-pending">Custom service: set a price with “Adjust price” before sending.</p>}
          {q.recurring_cents !== null && q.recurring_cents !== q.estimate_cents && <p className="text-sm text-muted">Recurring visits from {formatCents(q.recurring_cents)}</p>}
          {q.override_cents !== null && (
            <p className="mt-2 rounded-[var(--radius-control)] bg-cream p-3 text-sm">Adjusted from {formatCents(q.estimate_cents)} by {q.override_by_name ?? "staff"} on {q.override_at ? formatDateTime(q.override_at, tz) : "—"}.<br /><span className="text-muted">Reason: {q.override_reason}</span></p>
          )}
          <table className="mt-4 w-full text-sm"><tbody>
            {q.breakdown.lines.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{l.label}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</td><td className="py-1.5 text-right tabular-nums">{formatCents(l.amount_cents)}</td></tr>)}
            <tr className="border-t-2 border-charcoal font-semibold"><td className="py-1.5">Calculated total</td><td className="py-1.5 text-right tabular-nums">{formatCents(q.estimate_cents)}</td></tr>
          </tbody></table>
          {q.breakdown.notes.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-muted">{q.breakdown.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <p className="mt-3 text-xs text-muted">Priced with pricing version {q.pricing_version}. Later price changes don&apos;t alter this quote.</p>
        </section>

        <section className="card p-5">
          <h2 className="text-2xl font-semibold">Details</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Service</dt><dd>{q.service_name}</dd>
            <dt className="text-muted">Frequency</dt><dd>{FREQUENCY_LABELS[q.frequency as Frequency] ?? q.frequency}</dd>
            <dt className="text-muted">Home</dt><dd>{inputs.bedrooms ?? "?"} bed · {inputs.full_baths ?? "?"} bath{inputs.half_baths ? ` + ${inputs.half_baths} half` : ""}{inputs.sqft ? ` · ${inputs.sqft.toLocaleString()} sq ft` : q.breakdown.sqft_assumed ? " · sq ft assumed" : ""}</dd>
            <dt className="text-muted">Condition</dt><dd>{inputs.condition ? CONDITION_LABELS[inputs.condition] : "Not given"}</dd>
            <dt className="text-muted">Pets</dt><dd>{inputs.pets ?? 0}</dd>
            <dt className="text-muted">Area</dt><dd>{inputs.area ?? "Outside listed areas"}</dd>
            <dt className="text-muted">Address</dt><dd>{q.has_address ? q.address : "—"}</dd>
            <dt className="text-muted">Est. time</dt><dd>{minutesLabel(q.estimated_minutes)}</dd>
            <dt className="text-muted">Created</dt><dd>{formatDateTime(q.created_at, tz)}</dd>
            <dt className="text-muted">Sent</dt><dd>{q.sent_at ? formatDateTime(q.sent_at, tz) : "Not sent"}</dd>
            <dt className="text-muted">Expires</dt><dd>{q.expires_at ? formatDate(q.expires_at, tz) : "—"}</dd>
            {q.accepted_at && <><dt className="text-muted">Accepted</dt><dd>{formatDateTime(q.accepted_at, tz)}</dd></>}
          </dl>
          {(inputs.special_requests || inputs.staff_notes) && <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-cream p-3 text-sm">{inputs.special_requests || inputs.staff_notes}</p>}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="text-2xl font-semibold">Appointments & emails</h2>
        {d.appointments.length === 0 && d.comms.length === 0 && <p className="mt-2 text-sm text-muted">Nothing yet.</p>}
        <ul className="mt-3 divide-y divide-line text-sm">
          {d.appointments.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><Link href={`/admin/appointments/${a.id}`} className="font-semibold hover:text-gold-ink">{formatDateTime(a.starts_at, tz)} · {a.reference}</Link><StatusBadge status={a.status} /></li>)}
          {d.comms.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-2"><span>{c.subject}<span className="block text-xs text-muted">{formatDateTime(c.created_at, tz)}{c.error ? ` · ${c.error}` : ""}</span></span><StatusBadge status={c.status} /></li>)}
        </ul>
      </section>
    </div>
  );
}
