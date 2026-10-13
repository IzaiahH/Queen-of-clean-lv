"use client";

import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { createAppointmentAction } from "@/app/admin/actions/appointments";
import { searchCustomersAction } from "@/app/admin/actions/calendar";
import { ConflictDialog } from "@/components/ui/ConflictDialog";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";
import type { CleanerOption } from "./AppointmentPanel";

export type ServiceOption = { slug: string; name: string; default_minutes: number };
type CustomerHit = { id: string; full_name: string; email: string | null; phone: string | null; properties: { id: string; label: string; address: string | null; has_address: boolean }[]; last_price: number | null; last_minutes: number | null };

const FREQS = [
  { v: "", l: "One time" },
  { v: "weekly", l: "Every week" },
  { v: "biweekly", l: "Every 2 weeks" },
  { v: "monthly", l: "Every month" },
  { v: "quarterly", l: "Every 3 months" },
  { v: "custom", l: "Custom (every N days)" },
] as const;

/** Staff booking form. Used from the calendar (click a time) and from a customer's profile. */
export function NewAppointmentDialog({ open, onClose, tz, services, cleaners, initialStart, initialMinutes, customer, onCreated, quote }: {
  open: boolean; onClose: () => void; tz: string; services: ServiceOption[]; cleaners: CleanerOption[];
  initialStart?: string | null; initialMinutes?: number | null; customer?: CustomerHit | null; onCreated?: () => void;
  /** Booking an agreed quote: fixes the service, price and length to the quote's. */
  quote?: { id: string; reference: string; service_slug: string; price_cents: number; minutes: number; property_id: string | null; frequency: string } | null;
}) {
  const { run, pending, conflicts, clearConflicts } = useAction();
  const [q, setQ] = useState("");
  const [found, setHits] = useState<CustomerHit[]>([]);
  const [cust, setCust] = useState<CustomerHit | null>(customer ?? null);
  const [propertyId, setPropertyId] = useState("");
  const [service, setService] = useState(services[0]?.slug ?? "");
  const [start, setStart] = useState("");
  const [minutes, setMinutes] = useState(180);
  const [price, setPrice] = useState("");
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"confirmed" | "pending">("confirmed");
  const [freq, setFreq] = useState<string>("");
  const [interval, setInterval] = useState(21);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  // Reset the form each time the dialog opens with new defaults.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    const s = initialStart ? DateTime.fromISO(initialStart).setZone(tz) : DateTime.now().setZone(tz).plus({ days: 1 }).set({ hour: 9, minute: 0 });
    setStart(s.toFormat("yyyy-LL-dd'T'HH:mm"));
    if (initialMinutes && initialMinutes >= 60) setMinutes(initialMinutes);
    setError("");
    if (customer) pick(customer);
    if (quote) {
      setService(quote.service_slug);
      setPrice(centsToInput(quote.price_cents));
      setMinutes(quote.minutes);
      if (quote.property_id) setPropertyId(quote.property_id);
      if (["weekly", "biweekly", "monthly", "quarterly"].includes(quote.frequency)) setFreq(quote.frequency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStart, initialMinutes]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (cust || q.trim().length < 2) return;
    const t = setTimeout(async () => {
      const r = await searchCustomersAction(q);
      if (r.ok) setHits(r.data as CustomerHit[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q, cust]);
  const hits = cust || q.trim().length < 2 ? [] : found;

  function pick(c: CustomerHit) {
    setCust(c);
    setHits([]);
    setPropertyId(c.properties[0]?.id ?? "");
    if (c.last_price && !quote) setPrice(centsToInput(c.last_price));
    if (c.last_minutes && !quote) setMinutes(c.last_minutes);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const priceCents = parseMoneyToCents(price);
    if (!cust) return setError("Choose a customer.");
    if (!propertyId) return setError("This customer has no property on file. Add one on their profile first.");
    if (priceCents === null) return setError("Enter the price for this visit.");
    const startsAt = DateTime.fromISO(start, { zone: tz });
    if (!startsAt.isValid) return setError("Choose a start time.");
    run((force) => createAppointmentAction({
      customer_id: cust.id, property_id: propertyId, service_slug: service, starts_at: startsAt.toUTC().toISO()!, duration_minutes: minutes,
      price_cents: priceCents, cleaner_ids: cleanerIds, status, frequency: freq || "one_time", internal_notes: notes,
      recurring: freq ? { frequency: freq as "weekly", interval_days: freq === "custom" ? interval : null } : null,
      quote_id: quote?.id ?? null,
    }, force), { onSuccess: () => { onClose(); onCreated?.(); reset(); } });
  }

  function reset() {
    setCust(customer ?? null); setQ(""); setPrice(""); setCleanerIds([]); setFreq(""); setNotes("");
  }

  const prop = cust?.properties.find((p) => p.id === propertyId);
  return (
    <>
      <Dialog open={open} onClose={onClose} title={quote ? `Book quote ${quote.reference}` : "New appointment"} wide>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="na-cust">Customer</label>
            {cust ? (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line bg-white px-3 py-2">
                <div className="min-w-0"><p className="truncate font-semibold">{cust.full_name}</p><p className="truncate text-xs text-muted">{[cust.email, cust.phone].filter(Boolean).join(" · ") || "No contact details"}</p></div>
                {!customer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCust(null); setPropertyId(""); }}>Change</button>}
              </div>
            ) : (
              <div className="relative">
                <input id="na-cust" className="input" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                {hits.length > 0 && (
                  <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-white shadow-[var(--shadow-lift)]" role="listbox">
                    {hits.map((h) => (
                      <li key={h.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => pick(h)}><span className="font-semibold">{h.full_name}</span><span className="block text-xs text-muted">{h.email ?? h.phone ?? ""}</span></button></li>
                    ))}
                  </ul>
                )}
                {q.trim().length >= 2 && hits.length === 0 && <p className="field-hint">No match yet. New customers are added from Customers → New customer.</p>}
              </div>
            )}
          </div>
          {cust && (
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="na-prop">Property</label>
              <select id="na-prop" className="input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {cust.properties.length === 0 && <option value="">No property on file</option>}
                {cust.properties.map((p) => <option key={p.id} value={p.id}>{p.label}{p.address ? ` · ${p.address}` : ""}</option>)}
              </select>
              {prop && !prop.has_address && <p className="field-hint text-status-pending">This property has no street address yet. Add it on the customer profile before the visit.</p>}
            </div>
          )}
          <div>
            <label className="field-label" htmlFor="na-svc">Service</label>
            <select id="na-svc" className="input" value={service} onChange={(e) => { setService(e.target.value); const s = services.find((x) => x.slug === e.target.value); if (s && !cust?.last_minutes) setMinutes(s.default_minutes); }}>
              {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="na-start">Start</label>
            <input id="na-start" type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} step={900} />
          </div>
          <div>
            <label className="field-label" htmlFor="na-dur">Length (minutes)</label>
            <input id="na-dur" type="number" inputMode="numeric" min={15} max={960} step={15} className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </div>
          <div>
            <label className="field-label" htmlFor="na-price">Price per visit</label>
            <input id="na-price" inputMode="decimal" className="input" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />
            {cust?.last_price ? <p className="field-hint">Last visit: {formatCents(cust.last_price)}</p> : null}
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="field-label">Cleaners</legend>
            {cleaners.length === 0 ? <p className="text-sm text-muted">No active cleaners yet. You can assign later.</p> : (
              <div className="flex flex-wrap gap-2">
                {cleaners.map((c) => (
                  <label key={c.id} className="choice !min-h-10 !px-3 !py-2 text-sm">
                    <input type="checkbox" checked={cleanerIds.includes(c.id)} onChange={(e) => setCleanerIds(e.target.checked ? [...cleanerIds, c.id] : cleanerIds.filter((x) => x !== c.id))} />
                    <span className="size-3 rounded-full" style={{ background: c.color }} aria-hidden />{c.full_name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div>
            <label className="field-label" htmlFor="na-freq">Repeats</label>
            <select id="na-freq" className="input" value={freq} onChange={(e) => setFreq(e.target.value)}>
              {FREQS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
            </select>
            {freq === "custom" && (
              <div className="mt-2 flex items-center gap-2 text-sm"><span>Every</span><input aria-label="Days between visits" type="number" min={1} max={365} className="input w-24" value={interval} onChange={(e) => setInterval(Number(e.target.value))} /><span>days</span></div>
            )}
            {freq && <p className="field-hint">Visits are created ahead automatically. Conflicts are flagged, never double-booked.</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="na-status">Status</label>
            <select id="na-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as "confirmed")} disabled={Boolean(freq)}>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending (tentative)</option>
            </select>
            {freq && <p className="field-hint">Recurring visits are created as confirmed.</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="na-notes">Internal notes <span className="font-normal text-muted">(staff only)</span></label>
            <textarea id="na-notes" className="input" rows={2} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="field-error sm:col-span-2" role="alert">{error}</p>}
          <div className="flex gap-3 sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : freq ? "Create recurring schedule" : "Create appointment"}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
          <p className="text-xs text-muted sm:col-span-2">No email is sent when staff create an appointment. Send a confirmation from the appointment if needed.</p>
        </form>
      </Dialog>
      <ConflictDialog conflicts={conflicts} onCancel={clearConflicts} />
    </>
  );
}
