import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Mail, MapPin, Phone, Repeat } from "lucide-react";
import { PageHeader } from "@/components/admin/AdminShell";
import { EMPTY_PROPERTY, EditCustomerButton, PropertyButton, type PropertyFormValue } from "@/components/admin/CustomerForms";
import { BookFromProfile, CustomerStatusButtons, DeletePaymentButton, MergeButton, RecordPaymentButton } from "@/components/admin/CustomerWidgets";
import { Stat } from "@/components/admin/Stat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { formatCents } from "@/lib/money";
import { staffFormOptions } from "@/lib/server/admin-queries";
import { getCustomerProfile } from "@/lib/server/customers";
import { getSettings } from "@/lib/server/settings";
import { frequencyLabel } from "@/lib/scheduling/recurrence";
import { formatDate, formatDateTime } from "@/lib/time";

export const metadata = { title: "Customer" };

const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("customers.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [p, opts, settings] = await Promise.all([getCustomerProfile(id), staffFormOptions(), getSettings()]);
  if (!p) notFound();
  if (p.c.merged_into_id) redirect(`/admin/customers/${p.c.merged_into_id}`);
  const tz = settings.booking.timezone;
  const money = can(user.role, "finance.view");
  const canEdit = can(user.role, "customers.edit");
  // eslint-disable-next-line react-hooks/purity -- server component, rendered once per request
  const now = Date.now();
  const upcoming = p.appointments.filter((a) => new Date(a.starts_at).getTime() >= now && ["pending", "confirmed"].includes(a.status)).reverse();
  const past = p.appointments.filter((a) => !upcoming.includes(a));
  const cancelled = p.appointments.filter((a) => a.status === "cancelled").length;
  const hit = {
    id: p.c.id, full_name: p.c.full_name, email: p.c.email, phone: p.c.phone,
    properties: p.properties.map((x) => ({ id: x.id, label: x.label, address: [x.address_line1, x.unit, x.city].filter(Boolean).join(", "), has_address: Boolean(x.address_line1) })),
    last_price: p.appointments[0]?.agreed_price_cents ?? null, last_minutes: null,
  };
  const propValue = (x: (typeof p.properties)[number]): PropertyFormValue => ({
    label: x.label, address_line1: x.address_line1 ?? "", unit: x.unit ?? "", city: x.city ?? "", state: x.state ?? "NV", zip: x.zip ?? "", property_type: x.property_type ?? "house",
    bedrooms: s(x.bedrooms), full_baths: s(x.full_baths), half_baths: s(x.half_baths), sqft: s(x.sqft), pets: x.pets ?? "", condition: x.condition ?? "",
    access_instructions: x.access_instructions ?? "", special_requirements: x.special_requirements ?? "", is_primary: Boolean(x.is_primary),
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`Customer · ${p.c.source === "import" ? "Imported" : p.c.source === "website" ? "From website" : "Added by staff"}`} title={p.c.full_name}
        actions={canEdit ? <>
          <BookFromProfile customer={hit} tz={tz} services={opts.services} cleaners={opts.cleaners} />
          {can(user.role, "quotes.edit") && <Link href={`/admin/quotes/new?customer=${p.c.id}`} className="btn btn-outline btn-sm">New quote</Link>}
          <EditCustomerButton id={p.c.id} initial={{ full_name: p.c.full_name, email: p.c.email ?? "", phone: p.c.phone ?? "", preferred_contact: p.c.preferred_contact as "email", status: p.c.status as "active", preferences: p.c.preferences, private_notes: p.c.private_notes, marketing_consent: p.c.marketing_consent }} />
          {can(user.role, "customers.merge") && <MergeButton keepId={p.c.id} keepName={p.c.full_name} suggestions={p.duplicates} />}
          <CustomerStatusButtons id={p.c.id} status={p.c.status} />
        </> : undefined}>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <StatusBadge status={p.c.status} />
          {p.c.phone && <a href={`tel:${p.c.phone}`} className="inline-flex items-center gap-1 hover:text-gold-ink"><Phone className="size-4" aria-hidden />{p.c.phone}</a>}
          {p.c.email && <a href={`mailto:${p.c.email}`} className="inline-flex items-center gap-1 hover:text-gold-ink"><Mail className="size-4" aria-hidden />{p.c.email}</a>}
          <span className="text-muted">Prefers {p.c.preferred_contact === "text" ? "text" : p.c.preferred_contact === "phone" ? "a call" : "email"}</span>
          {p.c.customer_since && <span className="text-muted">Customer since {formatDate(new Date(`${p.c.customer_since}T12:00:00Z`), tz)}</span>}
        </div>
      </PageHeader>

      {p.duplicates.length > 0 && (
        <div className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-3 text-sm text-status-pending">
          Possible duplicate: {p.duplicates.map((d) => <Link key={d.id} href={`/admin/customers/${d.id}`} className="font-semibold underline">{d.full_name} ({d.reason.toLowerCase()})</Link>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
        </div>
      )}

      {money && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Completed visits" value={p.finance.completed_count} note={cancelled ? `${cancelled} cancelled` : undefined} />
          <Stat label="Lifetime revenue" value={formatCents(p.finance.completed_revenue)} tone="gold" note="Completed jobs" />
          <Stat label="Profit (recorded)" value={formatCents(p.finance.profit.profit_cents)} note={p.finance.profit.margin_pct !== null ? `${p.finance.profit.margin_pct}% margin` : "Labor + job costs"} />
          <Stat label="Paid" value={formatCents(p.finance.paid)} note={p.finance.completed_revenue > p.finance.paid ? `${formatCents(p.finance.completed_revenue - p.finance.paid)} not recorded as paid` : "Recorded payments"} />
          <Stat label="Recurring / month" value={formatCents(p.finance.recurring_monthly_projection_cents)} tone="estimate" note="Projection from active schedules" />
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <section className="card p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-2xl font-semibold">Properties</h2>{canEdit && <PropertyButton customerId={p.c.id} propertyId={null} initial={{ ...EMPTY_PROPERTY, is_primary: p.properties.length === 0 }} label="Add property" />}</div>
            {p.properties.length === 0 ? <p className="mt-2 text-sm text-muted">No property yet. Add one to book a cleaning.</p> : (
              <ul className="mt-3 space-y-3">
                {p.properties.map((x) => (
                  <li key={x.id} className="rounded-[var(--radius-control)] border border-line p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{x.label}{x.is_primary && <span className="ml-2 text-xs font-normal text-muted">Primary</span>}</p>
                        <p className="flex items-start gap-1"><MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />{x.address_line1 ? [x.address_line1, x.unit, x.city, x.zip].filter(Boolean).join(", ") : <span className="font-semibold text-status-pending">Address missing</span>}{x.area ? ` · ${x.area}` : ""}</p>
                        <p className="text-muted">{[x.bedrooms !== null && `${x.bedrooms} bed`, x.full_baths !== null && `${x.full_baths} bath${x.half_baths ? ` + ${x.half_baths} half` : ""}`, x.sqft && `${x.sqft.toLocaleString()} sq ft`, x.pets && `Pets: ${x.pets}`].filter(Boolean).join(" · ") || "Size not recorded"}</p>
                        {x.access_instructions && <p className="mt-1"><span className="font-semibold">Access (private):</span> {x.access_instructions}</p>}
                        {x.special_requirements && <p className="mt-1"><span className="font-semibold">Special:</span> {x.special_requirements}</p>}
                      </div>
                      {canEdit && <PropertyButton customerId={p.c.id} propertyId={x.id} initial={propValue(x)} label="Edit" canDelete={x.appt_count === 0} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Preferences & notes</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div><dt className="font-semibold">Preferences</dt><dd className="whitespace-pre-wrap text-muted">{p.c.preferences || "—"}</dd></div>
              <div><dt className="font-semibold">Private notes (staff only)</dt><dd className="whitespace-pre-wrap text-muted">{p.c.private_notes || "—"}</dd></div>
              <div><dt className="font-semibold">Marketing emails</dt><dd className="text-muted">{p.c.marketing_consent ? "Agreed" : "Not agreed"}</dd></div>
            </dl>
          </section>

          {p.series.length > 0 && (
            <section className="card p-5">
              <h2 className="flex items-center gap-2 text-2xl font-semibold"><Repeat className="size-5 text-gold" aria-hidden />Recurring schedules</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {p.series.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line p-3">
                    <span>{frequencyLabel(x.frequency as "weekly", x.interval_days)} · {x.start_time.slice(0, 5)} · {formatCents(x.price_cents)}<span className="block text-xs text-muted">Since {x.anchor_date}</span></span>
                    <StatusBadge status={x.status} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Change a schedule from any of its visits (Edit this and future / all).</p>
            </section>
          )}

          {p.messages.length > 0 && (
            <section className="card p-5">
              <h2 className="text-2xl font-semibold">Website messages</h2>
              <ul className="mt-3 space-y-2 text-sm">{p.messages.map((m) => <li key={m.id} className="rounded-[var(--radius-control)] border border-line p-3"><p className="text-xs text-muted">{formatDateTime(m.created_at, tz)} · {m.status}</p><p className="whitespace-pre-wrap">{m.message}</p></li>)}</ul>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Upcoming</h2>
            {upcoming.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing booked.</p> : (
              <ul className="mt-3 divide-y divide-line">{upcoming.map((a) => (
                <li key={a.id}><Link href={`/admin/appointments/${a.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-cream/40">
                  <span><span className="font-semibold">{formatDateTime(a.starts_at, tz)}</span>{a.series_id && <Repeat className="ml-1 inline size-3.5 text-gold" aria-label="Recurring" />}<span className="block text-xs text-muted">{a.service_name} · {formatCents(a.agreed_price_cents)} · {a.cleaner_names.join(", ") || "Unassigned"}</span></span>
                  <StatusBadge status={a.status} />
                </Link></li>
              ))}</ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">History</h2>
            {past.length === 0 ? <p className="mt-2 text-sm text-muted">No past visits.</p> : (
              <ul className="mt-3 max-h-[28rem] divide-y divide-line overflow-y-auto">{past.map((a) => (
                <li key={a.id}><Link href={`/admin/appointments/${a.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-cream/40">
                  <span><span className="font-semibold">{formatDate(a.starts_at, tz)}</span><span className="block text-xs text-muted">{a.service_name} · {formatCents(a.revenue_cents ?? a.agreed_price_cents)}{a.revenue_cents === null && a.status === "completed" ? " (agreed)" : ""} · {a.cleaner_names.join(", ") || "—"}</span></span>
                  <StatusBadge status={a.status} />
                </Link></li>
              ))}</ul>
            )}
          </section>

          {p.quotes.length > 0 && (
            <section className="card p-5">
              <h2 className="text-2xl font-semibold">Quotes</h2>
              <ul className="mt-3 divide-y divide-line">{p.quotes.map((q) => (
                <li key={q.id}><Link href={`/admin/quotes/${q.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-cream/40">
                  <span><span className="font-mono text-xs">{q.reference}</span><span className="block text-xs text-muted">{formatDate(q.created_at, tz)} · {formatCents(q.override_cents ?? q.estimate_cents)}{q.override_cents !== null ? " (adjusted)" : ""}</span></span>
                  <StatusBadge status={q.status} />
                </Link></li>
              ))}</ul>
            </section>
          )}

          {money && (
            <section className="card p-5">
              <div className="flex items-center justify-between gap-2"><h2 className="text-2xl font-semibold">Payments</h2>
                {can(user.role, "finance.edit") && <RecordPaymentButton customerId={p.c.id} appointments={p.appointments.filter((a) => a.status === "completed").slice(0, 30).map((a) => ({ id: a.id, label: `${formatDate(a.starts_at, tz)} · ${formatCents(a.revenue_cents ?? a.agreed_price_cents)}` }))} />}
              </div>
              {p.payments.length === 0 ? <p className="mt-2 text-sm text-muted">No payments recorded. Payment tracking is optional.</p> : (
                <ul className="mt-3 divide-y divide-line text-sm">{p.payments.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 py-2"><span><span className="font-semibold">{formatCents(x.amount_cents)}</span> · {x.method}<span className="block text-xs text-muted">{formatDate(x.received_at, tz)}{x.notes ? ` · ${x.notes}` : ""}</span></span>{can(user.role, "finance.edit") && <DeletePaymentButton id={x.id} />}</li>
                ))}</ul>
              )}
            </section>
          )}

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Emails</h2>
            {p.comms.length === 0 ? <p className="mt-2 text-sm text-muted">No emails yet.</p> : (
              <ul className="mt-3 divide-y divide-line text-sm">{p.comms.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-2 py-2"><span><span className="font-semibold">{x.subject || x.template}</span><span className="block text-xs text-muted">{formatDateTime(x.created_at, tz)}{x.error ? ` · ${x.error}` : ""}</span></span><StatusBadge status={x.status} /></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
