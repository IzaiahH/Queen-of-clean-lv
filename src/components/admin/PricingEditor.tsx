"use client";

import { useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { discardDraftAction, publishDraftAction, saveDraftAction, testRulesAction } from "@/app/admin/actions/pricing";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useAction } from "@/components/ui/useAction";
import { formatCents } from "@/lib/money";
import { CONDITIONS, CONDITION_LABELS, FREQUENCIES, FREQUENCY_LABELS, type Frequency, type PricingRules } from "@/lib/pricing/rules";
import { minutesLabel } from "@/lib/time";

/** Dollar input bound to an integer-cents value. Keeps the typed text while editing. */
function Money({ label, cents, onChange, className = "" }: { label: string; cents: number; onChange: (c: number) => void; className?: string }) {
  const [text, setText] = useState((cents / 100).toFixed(2).replace(/\.00$/, ""));
  return (
    <label className={className}>
      <span className="field-label text-xs">{label}</span>
      <span className="relative block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        <input className="input !min-h-10 pl-6" inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); const n = Number(e.target.value.replace(/[$,]/g, "")); if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 100)); }} />
      </span>
    </label>
  );
}
function Num({ label, value, onChange, min = 0, max = 100000, step = 1, suffix, className = "" }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; className?: string }) {
  return (
    <label className={className}><span className="field-label text-xs">{label}{suffix ? <span className="font-normal text-muted"> ({suffix})</span> : null}</span>
      <input className="input !min-h-10" type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

type Names = { services: { slug: string; name: string; active: boolean }[]; addons: { slug: string; name: string; active: boolean }[] };

export function PricingEditor({ initial, initialNotes, names, initialWarnings, draftVersion, publishedVersion }: {
  initial: PricingRules; initialNotes: string; names: Names; initialWarnings: string[]; draftVersion: number; publishedVersion: number;
}) {
  const [r, setR] = useState<PricingRules>(initial);
  const [notes, setNotes] = useState(initialNotes);
  const [warnings, setWarnings] = useState(initialWarnings);
  const [dirty, setDirty] = useState(false);
  const { run, pending } = useAction();
  const upd = (fn: (d: PricingRules) => void) => { const next = structuredClone(r); fn(next); setR(next); setDirty(true); };
  const svcName = (slug: string) => names.services.find((s) => s.slug === slug)?.name ?? slug;
  const addonName = (slug: string) => names.addons.find((s) => s.slug === slug)?.name ?? slug;
  const missingServices = names.services.filter((s) => !r.services[s.slug]);
  const missingAddons = names.addons.filter((a) => !r.addons[a.slug]);

  const save = () => run(() => saveDraftAction(r, notes), { onSuccess: (res) => { setWarnings((res.data as { warnings: string[] }).warnings); setDirty(false); } });

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-line bg-ivory/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[var(--radius-card)] sm:border">
        <p className="mr-auto text-sm"><span className="font-semibold">Draft v{draftVersion}</span> <span className="text-muted">· Live: v{publishedVersion}{dirty ? " · Unsaved changes" : ""}</span></p>
        <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={save}>Save draft</button>
        <ConfirmButton className="btn btn-primary btn-sm" disabled={pending || dirty} label="Publish" title={`Publish version ${draftVersion}?`} confirmLabel="Publish prices"
          body={<p>New website quotes and staff quotes will use these prices immediately. Existing quotes and booked appointments keep the price they were given.{warnings.length ? ` There ${warnings.length === 1 ? "is 1 warning" : `are ${warnings.length} warnings`} to review first.` : ""}</p>}
          onConfirm={() => run(() => publishDraftAction(notes))} />
        <ConfirmButton className="btn btn-ghost btn-sm text-danger" disabled={pending} label="Discard" title="Discard this draft?" confirmLabel="Discard" danger body="Your draft changes will be lost. Live prices are not affected." onConfirm={() => run(() => discardDraftAction())} />
      </div>
      {dirty && <p className="text-xs text-muted">Save the draft before publishing.</p>}

      {warnings.length > 0 && (
        <div className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-4 text-sm text-status-pending" role="status">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" aria-hidden />Check these before publishing</p>
          <ul className="mt-1 list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Services</h2>
            <p className="text-sm text-muted">Base price covers the included bedrooms and bathrooms. The minimum is the lowest total for that frequency.</p>
            <div className="mt-4 space-y-6">
              {[...names.services.map((x) => x.slug).filter((k) => r.services[k]), ...Object.keys(r.services).filter((k) => !names.services.some((x) => x.slug === k))].map((slug) => [slug, r.services[slug]] as const).map(([slug, s]) => (
                <div key={slug} className="rounded-[var(--radius-control)] border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xl font-semibold">{svcName(slug)}</h3>
                    <label className="flex items-center gap-2 text-sm"><span>Pricing</span>
                      <select className="input !min-h-9 w-auto !py-1" value={s.quote_mode} onChange={(e) => upd((d) => { d.services[slug].quote_mode = e.target.value as "estimate"; })}><option value="estimate">Instant estimate</option><option value="custom">Custom quote only</option></select>
                    </label>
                  </div>
                  {s.quote_mode === "estimate" && (
                    <>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {FREQUENCIES.map((f) => {
                          const p = s.frequencies[f];
                          return (
                            <div key={f} className={`rounded-[var(--radius-control)] border p-3 ${p ? "border-gold/50 bg-white" : "border-dashed border-line"}`}>
                              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(p)} onChange={(e) => upd((d) => { if (e.target.checked) d.services[slug].frequencies[f] = { base_cents: 0, minimum_cents: 0 }; else delete d.services[slug].frequencies[f]; })} />{FREQUENCY_LABELS[f]}</label>
                              {p && <div className="mt-2 grid grid-cols-2 gap-2">
                                <Money label="Base" cents={p.base_cents} onChange={(c) => upd((d) => { d.services[slug].frequencies[f]!.base_cents = c; })} />
                                <Money label="Minimum" cents={p.minimum_cents} onChange={(c) => upd((d) => { d.services[slug].frequencies[f]!.minimum_cents = c; })} />
                              </div>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs text-muted">Turning a frequency on here doesn&apos;t offer it to customers by itself; also allow it on the Services tab.</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Num label="Bedrooms included" value={s.included_bedrooms} max={10} onChange={(n) => upd((d) => { d.services[slug].included_bedrooms = n; })} />
                        <Num label="Full baths included" value={s.included_full_baths} max={10} onChange={(n) => upd((d) => { d.services[slug].included_full_baths = n; })} />
                        <Money label="Each extra bedroom" cents={s.per_extra_bedroom_cents} onChange={(c) => upd((d) => { d.services[slug].per_extra_bedroom_cents = c; })} />
                        <Money label="Each extra full bath" cents={s.per_extra_full_bath_cents} onChange={(c) => upd((d) => { d.services[slug].per_extra_full_bath_cents = c; })} />
                        <Money label="Each half bath" cents={s.per_half_bath_cents} onChange={(c) => upd((d) => { d.services[slug].per_half_bath_cents = c; })} />
                      </div>
                    </>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Num label="Base time" suffix="min" value={s.base_minutes} min={30} max={960} step={15} onChange={(n) => upd((d) => { d.services[slug].base_minutes = n; })} />
                    <Num label="+ per extra bedroom" suffix="min" value={s.minutes_per_extra_bedroom} max={240} step={5} onChange={(n) => upd((d) => { d.services[slug].minutes_per_extra_bedroom = n; })} />
                    <Num label="+ per extra full bath" suffix="min" value={s.minutes_per_extra_full_bath} max={240} step={5} onChange={(n) => upd((d) => { d.services[slug].minutes_per_extra_full_bath = n; })} />
                    <Num label="+ per half bath" suffix="min" value={s.minutes_per_half_bath} max={240} step={5} onChange={(n) => upd((d) => { d.services[slug].minutes_per_half_bath = n; })} />
                  </div>
                </div>
              ))}
              {missingServices.map((s) => (
                <div key={s.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-dashed border-line p-4 text-sm">
                  <span><strong>{s.name}</strong> has no prices in this version{s.active ? " (it's turned on, so publishing will be blocked)" : ""}.</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.services[s.slug] = { quote_mode: "custom", frequencies: { one_time: { base_cents: 0, minimum_cents: 0 } }, included_bedrooms: 0, included_full_baths: 0, per_extra_bedroom_cents: 0, per_extra_full_bath_cents: 0, per_half_bath_cents: 0, base_minutes: 180, minutes_per_extra_bedroom: 0, minutes_per_extra_full_bath: 0, minutes_per_half_bath: 0 }; })}>Add prices</button>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Home size</h2>
            <p className="text-sm text-muted">Added to the base price by square footage. When a customer doesn&apos;t know their size, it&apos;s assumed from bedrooms.</p>
            <div className="mt-3 space-y-2">
              {r.sqft_bands.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  {b.up_to_sqft === null ? <p className="pb-2 text-sm font-semibold">Above {r.sqft_bands[i - 1]?.up_to_sqft?.toLocaleString() ?? 0} sq ft</p>
                    : <Num label="Up to (sq ft)" value={b.up_to_sqft} min={100} max={50000} step={100} onChange={(n) => upd((d) => { d.sqft_bands[i].up_to_sqft = n; })} />}
                  <Money label="Add" cents={b.adjust_cents} onChange={(c) => upd((d) => { d.sqft_bands[i].adjust_cents = c; })} />
                  <Num label="Extra time" suffix="min" value={b.adjust_minutes} min={-240} max={960} step={5} onChange={(n) => upd((d) => { d.sqft_bands[i].adjust_minutes = n; })} />
                  <button type="button" className="btn btn-ghost size-10 p-0" aria-label="Remove band" disabled={r.sqft_bands.length <= 1 || b.up_to_sqft === null} onClick={() => upd((d) => { d.sqft_bands.splice(i, 1); })}><Trash2 className="size-4" aria-hidden /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd((d) => { const last = d.sqft_bands.length - 1; const prev = d.sqft_bands[last - 1]?.up_to_sqft ?? 1000; d.sqft_bands.splice(last, 0, { up_to_sqft: prev + 1000, adjust_cents: d.sqft_bands[last - 1]?.adjust_cents ?? 0, adjust_minutes: d.sqft_bands[last - 1]?.adjust_minutes ?? 0 }); })}><Plus className="size-4" aria-hidden />Add band</button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {r.assumed_sqft_by_bedrooms.map((v, i) => <Num key={i} label={`${i}${i === r.assumed_sqft_by_bedrooms.length - 1 ? "+" : ""} bed`} suffix="sq ft" value={v} min={100} max={50000} step={50} onChange={(n) => upd((d) => { d.assumed_sqft_by_bedrooms[i] = n; })} />)}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Condition, pets & review</h2>
            <div className="mt-3 space-y-2">
              {CONDITIONS.map((c) => (
                <div key={c} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]">
                  <p className="col-span-2 text-sm font-semibold sm:col-span-1 sm:pb-2">{CONDITION_LABELS[c]}</p>
                  <Num label="Price +" suffix="%" value={r.conditions[c].percent} max={200} onChange={(n) => upd((d) => { d.conditions[c].percent = n; })} />
                  <Num label="Time +" suffix="%" value={r.conditions[c].minutes_percent} max={200} onChange={(n) => upd((d) => { d.conditions[c].minutes_percent = n; })} />
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={r.conditions[c].requires_review} onChange={(e) => upd((d) => { d.conditions[c].requires_review = e.target.checked; })} />Review</label>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Money label="Pet fee" cents={r.pets.fee_cents} onChange={(c) => upd((d) => { d.pets.fee_cents = c; })} />
              <Money label="Each extra pet" cents={r.pets.per_extra_pet_cents} onChange={(c) => upd((d) => { d.pets.per_extra_pet_cents = c; })} />
              <Num label="Pet time" suffix="min" value={r.pets.minutes} max={240} step={5} onChange={(n) => upd((d) => { d.pets.minutes = n; })} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Review homes over" suffix="sq ft" value={r.review.over_sqft} min={500} max={50000} step={100} onChange={(n) => upd((d) => { d.review.over_sqft = n; })} />
              <Num label="Review over" suffix="bedrooms" value={r.review.over_bedrooms} min={1} max={20} onChange={(n) => upd((d) => { d.review.over_bedrooms = n; })} />
              <label><span className="field-label text-xs">Round totals</span><select className="input !min-h-10" value={r.rounding} onChange={(e) => upd((d) => { d.rounding = e.target.value as "dollar"; })}><option value="none">Exact cents</option><option value="dollar">To the dollar</option><option value="five_dollars">To $5</option></select></label>
            </div>
            <div className="mt-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={r.tax.enabled} onChange={(e) => upd((d) => { d.tax.enabled = e.target.checked; })} />Add tax</label>
              {r.tax.enabled && <><Num label="Tax rate" suffix="%" value={r.tax.percent} max={20} step={0.01} onChange={(n) => upd((d) => { d.tax.percent = n; })} />
                <label><span className="field-label text-xs">Label</span><input className="input !min-h-10" value={r.tax.label} maxLength={40} onChange={(e) => upd((d) => { d.tax.label = e.target.value; })} /></label></>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Add-on prices</h2>
            <div className="mt-3 space-y-3">
              {[...names.addons.map((x) => x.slug).filter((k) => r.addons[k]), ...Object.keys(r.addons).filter((k) => !names.addons.some((x) => x.slug === k))].map((slug) => [slug, r.addons[slug]] as const).map(([slug, a]) => (
                <div key={slug} className="grid grid-cols-2 items-end gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
                  <p className="col-span-2 text-sm font-semibold sm:col-span-1 sm:pb-2">{addonName(slug)}</p>
                  <Money label={a.unit === "each" ? `Per ${a.unit_label || "unit"}` : "Price"} cents={a.price_cents} onChange={(c) => upd((d) => { d.addons[slug].price_cents = c; })} />
                  <label><span className="field-label text-xs">Charged</span><select className="input !min-h-10" value={a.unit} onChange={(e) => upd((d) => { d.addons[slug].unit = e.target.value as "flat"; if (e.target.value === "flat") d.addons[slug].max_quantity = 1; })}><option value="flat">Once</option><option value="each">Per unit</option></select></label>
                  {a.unit === "each" ? <><label><span className="field-label text-xs">Unit name</span><input className="input !min-h-10" value={a.unit_label} maxLength={30} onChange={(e) => upd((d) => { d.addons[slug].unit_label = e.target.value; })} /></label>
                    <Num label="Max qty" value={a.max_quantity} min={1} max={50} onChange={(n) => upd((d) => { d.addons[slug].max_quantity = n; })} /></> : <><span /><span /></>}
                  <Num label="Time" suffix="min" value={a.minutes} max={480} step={5} onChange={(n) => upd((d) => { d.addons[slug].minutes = n; })} />
                  <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-6"><input type="checkbox" checked={a.starting_at} onChange={(e) => upd((d) => { d.addons[slug].starting_at = e.target.checked; })} />Show as &quot;starting at&quot; (final amount confirmed on site)</label>
                </div>
              ))}
              {missingAddons.map((a) => (
                <div key={a.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-dashed border-line p-3 text-sm">
                  <span><strong>{a.name}</strong> has no price yet, so customers can&apos;t choose it.</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => upd((d) => { d.addons[a.slug] = { price_cents: 0, unit: "flat", unit_label: "", max_quantity: 1, minutes: 15, applies_to: ["*"], starting_at: false }; })}>Add price</button>
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Discounts & adjustments</h2>
            <p className="text-sm text-muted">Optional. Negative values are discounts (e.g. −10% for weekly). Applied before the minimum.</p>
            <div className="mt-3 space-y-2">
              {r.adjustments.map((a, i) => (
                <div key={a.id} className="grid grid-cols-2 items-end gap-2 rounded-[var(--radius-control)] border border-line p-3 sm:grid-cols-[1.5fr_1fr_1fr_1.5fr_auto]">
                  <label className="col-span-2 sm:col-span-1"><span className="field-label text-xs">Label</span><input className="input !min-h-10" value={a.label} maxLength={80} onChange={(e) => upd((d) => { d.adjustments[i].label = e.target.value; })} /></label>
                  <label><span className="field-label text-xs">Type</span><select className="input !min-h-10" value={a.kind} onChange={(e) => upd((d) => { d.adjustments[i].kind = e.target.value as "percent"; })}><option value="percent">Percent</option><option value="flat">Dollars</option></select></label>
                  <Num label={a.kind === "percent" ? "Percent" : "Cents (−1500 = −$15)"} value={a.value} min={-100000} max={100000} onChange={(n) => upd((d) => { d.adjustments[i].value = n; })} />
                  <label><span className="field-label text-xs">Frequencies</span><select className="input !min-h-10" value={a.frequencies[0] ?? ""} onChange={(e) => upd((d) => { d.adjustments[i].frequencies = e.target.value ? [e.target.value as Frequency] : []; })}><option value="">All</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}</select></label>
                  <div className="flex items-center gap-2 pb-1"><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={a.active} onChange={(e) => upd((d) => { d.adjustments[i].active = e.target.checked; })} />On</label>
                    <button type="button" className="btn btn-ghost size-10 p-0" aria-label="Remove" onClick={() => upd((d) => { d.adjustments.splice(i, 1); })}><Trash2 className="size-4" aria-hidden /></button></div>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => upd((d) => { d.adjustments.push({ id: `adj-${Date.now().toString(36)}`, label: "New adjustment", kind: "percent", value: 0, services: ["*"], frequencies: [], active: false }); })}><Plus className="size-4" aria-hidden />Add adjustment</button>
            </div>
          </section>

          <label className="block"><span className="field-label">Version notes</span><textarea className="input" rows={2} maxLength={1000} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="What changed and why" /></label>
        </div>

        <TestPanel rules={r} services={names.services.filter((s) => r.services[s.slug])} addons={names.addons.filter((a) => r.addons[a.slug])} />
      </div>
    </div>
  );
}

type TestOut = { total_cents: number; minutes: number; lines: { label: string; amount_cents: number }[]; review: string[]; mode: string } | { error: string };

function TestPanel({ rules, services, addons }: { rules: PricingRules; services: { slug: string; name: string }[]; addons: { slug: string; name: string }[] }) {
  const firstFreq = (slug: string) => (Object.keys(rules.services[slug]?.frequencies ?? {})[0] ?? "one_time") as Frequency;
  const [t, setT] = useState({ service: services[0]?.slug ?? "", frequency: firstFreq(services[0]?.slug ?? ""), bedrooms: 3, full_baths: 2, half_baths: 0, sqft: 1800 as number | null, condition: "standard" as (typeof CONDITIONS)[number] | null, pets: 0, travel_fee_cents: 0, addons: [] as { slug: string; quantity: number }[], area_requires_review: false });
  const [out, setOut] = useState<{ draft: TestOut; published: TestOut; published_version: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const r = await testRulesAction(rules, t);
    setBusy(false);
    if (r.ok) { setOut(r.data as typeof out); setErr(""); } else setErr(r.error ?? "Couldn't calculate.");
  }
  const show = (o: TestOut | undefined, title: string) => o && (
    <div className="rounded-[var(--radius-control)] border border-line bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
      {"error" in o ? <p className="text-sm text-danger">{o.error}</p> : <>
        <p className="font-display text-3xl font-semibold [font-variant-numeric:lining-nums]">{o.mode === "custom" ? "Custom quote" : formatCents(o.total_cents)}</p>
        <p className="text-xs text-muted">{minutesLabel(o.minutes)}</p>
        <ul className="mt-2 space-y-0.5 text-xs">{o.lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span>{l.label}</span><span className="tabular-nums">{formatCents(l.amount_cents)}</span></li>)}</ul>
        {o.review.length > 0 && <p className="mt-1 text-xs text-status-pending">Review: {o.review.join("; ")}</p>}
      </>}
    </div>
  );
  return (
    <aside className="card h-fit space-y-3 p-5 xl:sticky xl:top-20">
      <h2 className="text-2xl font-semibold">Test a price</h2>
      <p className="text-xs text-muted">Uses your unsaved draft and compares it with the live prices.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2"><span className="field-label text-xs">Service</span><select className="input !min-h-10" value={t.service} onChange={(e) => setT({ ...t, service: e.target.value, frequency: rules.services[e.target.value]?.frequencies[t.frequency] ? t.frequency : firstFreq(e.target.value) })}>{services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
        <label className="col-span-2"><span className="field-label text-xs">Frequency</span><select className="input !min-h-10" value={t.frequency} onChange={(e) => setT({ ...t, frequency: e.target.value as Frequency })}>{FREQUENCIES.filter((f) => rules.services[t.service]?.frequencies[f]).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}</select></label>
        <Num label="Bedrooms" value={t.bedrooms} max={20} onChange={(n) => setT({ ...t, bedrooms: n })} />
        <Num label="Full baths" value={t.full_baths} max={20} onChange={(n) => setT({ ...t, full_baths: n })} />
        <Num label="Half baths" value={t.half_baths} max={20} onChange={(n) => setT({ ...t, half_baths: n })} />
        <label><span className="field-label text-xs">Sq ft</span><input className="input !min-h-10" type="number" value={t.sqft ?? ""} placeholder="Not sure" onChange={(e) => setT({ ...t, sqft: e.target.value ? Number(e.target.value) : null })} /></label>
        <label><span className="field-label text-xs">Condition</span><select className="input !min-h-10" value={t.condition ?? ""} onChange={(e) => setT({ ...t, condition: (e.target.value || null) as "standard" })}><option value="">Not sure</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <Num label="Pets" value={t.pets} max={20} onChange={(n) => setT({ ...t, pets: n })} />
      </div>
      <details><summary className="cursor-pointer text-sm font-semibold">Extras ({t.addons.length})</summary>
        <div className="mt-2 space-y-1">{addons.map((a) => (
          <label key={a.slug} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={t.addons.some((x) => x.slug === a.slug)} onChange={(e) => setT({ ...t, addons: e.target.checked ? [...t.addons, { slug: a.slug, quantity: 1 }] : t.addons.filter((x) => x.slug !== a.slug) })} />{a.name}</label>
        ))}</div>
      </details>
      <button type="button" className="btn btn-dark w-full" disabled={busy} onClick={go}>{busy ? "Calculating…" : "Calculate"}</button>
      {err && <p className="field-error" role="alert">{err}</p>}
      {out && <div className="space-y-2">{show(out.draft, "This draft")}{show(out.published, `Live (v${out.published_version})`)}</div>}
    </aside>
  );
}
