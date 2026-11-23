"use client";

import { useState } from "react";
import { retireCustomerRateAction, saveCustomerStatusAction, setCustomerRateAction } from "@/app/admin/actions/customers";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";

type Rate = {
  id: string; service_slug: string; service_name: string; frequency: string; price_cents: number;
  kind: "historical" | "custom"; status: "active" | "retired"; source: "import" | "admin"; notes: string; created_at: string; retired_at: string | null;
};
const FREQ: Record<string, string> = { weekly: "Weekly", biweekly: "Every 2 weeks", monthly: "Monthly", quarterly: "Every 3 months", one_time: "One time" };

/** Customer-specific rates. Separate from the website's pricing; never recalculated. Changing one keeps the old one in history. */
export function CustomerRates({ customerId, rates, services, canEdit, fmtDate }: {
  customerId: string; rates: Rate[]; services: { slug: string; name: string }[]; canEdit: boolean; fmtDate: Record<string, string>;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ service_slug: services[0]?.slug ?? "recurring", frequency: "biweekly", price: "", notes: "" });
  const [error, setError] = useState("");
  const active = rates.filter((r) => r.status === "active");
  const retired = rates.filter((r) => r.status === "retired");

  function edit(r?: Rate) {
    setError("");
    setForm(r ? { service_slug: r.service_slug, frequency: r.frequency, price: centsToInput(r.price_cents), notes: "" } : { service_slug: services.find((s) => s.slug === "recurring")?.slug ?? services[0]?.slug ?? "", frequency: "biweekly", price: "", notes: "" });
    setOpen(true);
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseMoneyToCents(form.price);
    if (!cents || cents <= 0) return setError("Enter the price per visit.");
    run(() => setCustomerRateAction(customerId, { service_slug: form.service_slug, frequency: form.frequency as "weekly", price_cents: cents, notes: form.notes }), { onSuccess: () => setOpen(false) });
  }

  return (
    <section className="card p-5" aria-labelledby="rates-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="rates-h" className="text-2xl font-semibold">Customer rates</h2>
        {canEdit && <button type="button" className="btn btn-outline btn-sm" onClick={() => edit()}>Set a rate</button>}
      </div>
      <p className="mt-1 text-xs text-muted">This customer&apos;s own prices. They&apos;re offered when booking them, and never change the website&apos;s pricing or other customers&apos; prices.</p>
      {active.length === 0 ? <p className="mt-3 text-sm text-muted">No customer-specific rate. Bookings use standard pricing.</p> : (
        <ul className="mt-3 space-y-2">
          {active.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-gold/40 bg-cream/50 p-3 text-sm">
              <div>
                <p><span className="font-display text-2xl font-semibold">{formatCents(r.price_cents)}</span> <span className="text-muted">per visit</span></p>
                <p>{FREQ[r.frequency] ?? r.frequency} · {r.service_name}</p>
                <p className="text-xs text-muted">{r.kind === "historical" ? "Historical rate from existing records" : "Custom rate"} · since {fmtDate[r.id]}{r.notes ? ` · ${r.notes}` : ""}</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(r)}>Change</button>
                  <ConfirmButton label="Retire" title="Retire this rate?" confirmLabel="Retire" className="btn btn-ghost btn-sm" disabled={pending}
                    body={<p>Future bookings will use standard pricing unless you set a new rate. Past appointments keep the price they were booked at, and this rate stays in the history.</p>}
                    onConfirm={() => run(() => retireCustomerRateAction(customerId, r.id))} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {retired.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">Rate history ({retired.length})</summary>
          <ul className="mt-2 space-y-1 text-muted">
            {retired.map((r) => (
              <li key={r.id}>{formatCents(r.price_cents)} · {FREQ[r.frequency] ?? r.frequency} · {r.kind === "historical" ? "historical" : "custom"} · {fmtDate[r.id]}</li>
            ))}
          </ul>
        </details>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Set customer rate">
        <form onSubmit={save} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="cr-svc">Service</label>
              <select id="cr-svc" className="input" value={form.service_slug} onChange={(e) => setForm({ ...form, service_slug: e.target.value })}>
                {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="cr-freq">How often</label>
              <select id="cr-freq" className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label" htmlFor="cr-price">Price per visit</label>
            <input id="cr-price" inputMode="decimal" className="input" placeholder="0.00" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <p className="field-hint">If this customer already has a rate for this service and frequency, it moves to the history.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="cr-notes">Note <span className="font-normal text-muted">(optional)</span></label>
            <input id="cr-notes" className="input" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="flex gap-3"><button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save rate"}</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Dialog>
    </section>
  );
}

/** Shown on imported customers until someone confirms whether they're still a client. */
export function VerifyStatusBanner({ customerId, canEdit }: { customerId: string; canEdit: boolean }) {
  const { run, pending } = useAction();
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-status-pending/40 bg-status-pending-bg p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold text-status-pending">Existing client — verify current status</p>
        <p className="mt-1">Imported from your existing records. Confirm they&apos;re still a client, add their contact details and address, then book their next cleaning. No visits have been scheduled and nothing has been charged.</p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => saveCustomerStatusAction(customerId, "active"))}>Confirm active</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => saveCustomerStatusAction(customerId, "inactive"))}>No longer a client</button>
        </div>
      )}
    </div>
  );
}
