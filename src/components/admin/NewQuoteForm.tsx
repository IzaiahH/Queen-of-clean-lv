"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { searchCustomersAction } from "@/app/admin/actions/calendar";
import { createQuoteAction, previewQuoteAction, propertyForQuoteAction } from "@/app/admin/actions/quotes";
import { useAction } from "@/components/ui/useAction";
import { formatCents } from "@/lib/money";
import { CONDITIONS, CONDITION_LABELS, FREQUENCY_LABELS, type Condition, type Frequency } from "@/lib/pricing/rules";
import { minutesLabel } from "@/lib/time";

type Svc = { slug: string; name: string; allowed_frequencies: Frequency[] };
type Addon = { slug: string; name: string; max_quantity: number; unit_label: string };
type Hit = { id: string; full_name: string; email: string | null; properties: { id: string; label: string; address: string | null; has_address: boolean }[] };
type Preview = { lines: { label: string; amount_cents: number }[]; total_cents: number; recurring_per_visit_cents: number | null; estimated_minutes: number; requires_review: boolean; review_reasons: string[]; notes: string[]; mode: string; version: number; area: string | null; area_message: string | null };

export function NewQuoteForm({ services, addons, initialCustomer }: { services: Svc[]; addons: Addon[]; initialCustomer: Hit | null }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [found, setHits] = useState<Hit[]>([]);
  const [cust, setCust] = useState<Hit | null>(initialCustomer);
  const [propertyId, setPropertyId] = useState(initialCustomer?.properties[0]?.id ?? "");
  const [f, setF] = useState({ service: services[0]?.slug ?? "", frequency: (services[0]?.allowed_frequencies[0] ?? "one_time") as Frequency, property_type: "house", bedrooms: 3, full_baths: 2, half_baths: 0, sqft: "", condition: "standard" as Condition | "", pets: 0, zip: "" });
  const [sel, setSel] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [priced, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (cust || q.trim().length < 2) return;
    const t = setTimeout(async () => { const r = await searchCustomersAction(q); if (r.ok) setHits(r.data as Hit[]); }, 250);
    return () => clearTimeout(t);
  }, [q, cust]);

  useEffect(() => {
    if (!propertyId) return;
    void propertyForQuoteAction(propertyId).then((r) => {
      if (!r.ok) return;
      const p = r.data as { property_type: string; bedrooms: number | null; full_baths: number | null; half_baths: number; sqft: number | null; zip: string | null; condition: Condition | null };
      setF((cur) => ({ ...cur, property_type: p.property_type, bedrooms: p.bedrooms ?? cur.bedrooms, full_baths: p.full_baths ?? cur.full_baths, half_baths: p.half_baths, sqft: p.sqft ? String(p.sqft) : "", zip: p.zip ?? "", condition: p.condition ?? cur.condition }));
    });
  }, [propertyId]);

  const hits = cust || q.trim().length < 2 ? [] : found;
  const preview = /^\d{5}$/.test(f.zip) ? priced : null;
  const svc = services.find((s) => s.slug === f.service);
  const payload = () => ({
    service: f.service, frequency: f.frequency, property_type: f.property_type as "house", bedrooms: Number(f.bedrooms), full_baths: Number(f.full_baths), half_baths: Number(f.half_baths),
    sqft: f.sqft ? Number(f.sqft) : null, condition: (f.condition || null) as Condition | null, pets: Number(f.pets), zip: f.zip,
    addons: Object.entries(sel).filter(([, n]) => n > 0).map(([slug, quantity]) => ({ slug, quantity })),
  });

  useEffect(() => {
    if (!/^\d{5}$/.test(f.zip)) return;
    const t = setTimeout(async () => {
      const r = await previewQuoteAction(payload());
      if (r.ok) { setPreview(r.data as Preview); setErr(""); } else { setPreview(null); setErr(r.error ?? "Couldn't price this."); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, sel]);

  const set = (k: keyof typeof f, v: string | number) => setF({ ...f, [k]: v });
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <form className="card space-y-5 p-5" onSubmit={(e) => {
        e.preventDefault();
        if (!cust || !propertyId) return setErr("Choose a customer and one of their properties.");
        run(() => createQuoteAction({ customer_id: cust.id, property_id: propertyId, property: payload(), notes }), { onSuccess: (r) => router.push(`/admin/quotes/${(r.data as { id: string }).id}`) });
      }}>
        <div>
          <label className="field-label" htmlFor="nq-c">Customer</label>
          {cust ? (
            <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-line bg-white px-3 py-2"><span className="font-semibold">{cust.full_name}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCust(null); setPropertyId(""); }}>Change</button></div>
          ) : (
            <div className="relative">
              <input id="nq-c" className="input" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
              {hits.length > 0 && <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-white shadow-[var(--shadow-lift)]">{hits.map((h) => <li key={h.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => { setCust(h); setPropertyId(h.properties[0]?.id ?? ""); }}><span className="font-semibold">{h.full_name}</span> <span className="text-muted">{h.email ?? ""}</span></button></li>)}</ul>}
              <p className="field-hint">New customer? Add them under Customers first.</p>
            </div>
          )}
        </div>
        {cust && (
          <label className="block"><span className="field-label">Property</span>
            <select className="input" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>{cust.properties.length === 0 && <option value="">No property on file</option>}{cust.properties.map((p) => <option key={p.id} value={p.id}>{p.label}{p.address ? ` · ${p.address}` : ""}</option>)}</select>
          </label>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label><span className="field-label">Service</span><select className="input" value={f.service} onChange={(e) => { const s = services.find((x) => x.slug === e.target.value); setF({ ...f, service: e.target.value, frequency: s?.allowed_frequencies.includes(f.frequency) ? f.frequency : s?.allowed_frequencies[0] ?? "one_time" }); }}>{services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
          <label><span className="field-label">Frequency</span><select className="input" value={f.frequency} onChange={(e) => set("frequency", e.target.value)}>{svc?.allowed_frequencies.map((x) => <option key={x} value={x}>{FREQUENCY_LABELS[x]}</option>)}</select></label>
          <label><span className="field-label">Bedrooms</span><input type="number" min={0} max={20} className="input" value={f.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} /></label>
          <label><span className="field-label">Full baths</span><input type="number" min={0} max={20} className="input" value={f.full_baths} onChange={(e) => set("full_baths", e.target.value)} /></label>
          <label><span className="field-label">Half baths</span><input type="number" min={0} max={20} className="input" value={f.half_baths} onChange={(e) => set("half_baths", e.target.value)} /></label>
          <label><span className="field-label">Sq ft <span className="font-normal text-muted">(optional)</span></span><input type="number" min={100} max={50000} className="input" value={f.sqft} onChange={(e) => set("sqft", e.target.value)} /></label>
          <label><span className="field-label">Condition</span><select className="input" value={f.condition} onChange={(e) => set("condition", e.target.value)}><option value="">Not sure</option>{CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}</select></label>
          <label><span className="field-label">Pets</span><input type="number" min={0} max={20} className="input" value={f.pets} onChange={(e) => set("pets", e.target.value)} /></label>
          <label><span className="field-label">ZIP</span><input inputMode="numeric" maxLength={5} className="input" value={f.zip} onChange={(e) => set("zip", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <fieldset><legend className="field-label">Extras</legend>
          <div className="grid gap-2 sm:grid-cols-2">{addons.map((a) => (
            <label key={a.slug} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-white px-3 py-2 text-sm">
              <span>{a.name}</span>
              {a.max_quantity > 1
                ? <input type="number" min={0} max={a.max_quantity} aria-label={`${a.name} quantity`} className="input w-20 !min-h-9" value={sel[a.slug] ?? 0} onChange={(e) => setSel({ ...sel, [a.slug]: Number(e.target.value) })} />
                : <input type="checkbox" checked={Boolean(sel[a.slug])} onChange={(e) => setSel({ ...sel, [a.slug]: e.target.checked ? 1 : 0 })} />}
            </label>
          ))}</div>
        </fieldset>
        <label className="block"><span className="field-label">Notes for the record</span><textarea className="input" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <p className="field-error" role="alert">{err}</p>}
        <button className="btn btn-primary" disabled={pending || !preview}>{pending ? "Saving…" : "Save draft quote"}</button>
        <p className="text-xs text-muted">Saved as a draft. Review it, adjust the price if needed, then send it from the quote page.</p>
      </form>
      <aside className="card h-fit p-5 lg:sticky lg:top-6" aria-live="polite">
        <h2 className="text-2xl font-semibold">Estimate</h2>
        {!preview ? <p className="mt-2 text-sm text-muted">Enter a ZIP code to calculate.</p> : (
          <>
            <p className="mt-2 font-display text-4xl font-semibold text-gold-ink [font-variant-numeric:lining-nums]">{preview.mode === "custom" ? "Custom" : formatCents(preview.total_cents)}</p>
            <p className="text-sm text-muted">{minutesLabel(preview.estimated_minutes)} · pricing v{preview.version}{preview.area ? ` · ${preview.area}` : ""}</p>
            <table className="mt-3 w-full text-sm"><tbody>{preview.lines.map((l, i) => <tr key={i} className="border-t border-line"><td className="py-1">{l.label}</td><td className="py-1 text-right tabular-nums">{formatCents(l.amount_cents)}</td></tr>)}</tbody></table>
            {preview.area_message && <p className="mt-2 text-xs text-status-pending">{preview.area_message}</p>}
            {preview.review_reasons.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-status-pending">{preview.review_reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </>
        )}
      </aside>
    </div>
  );
}
