"use client";

import { useState } from "react";
import { saveAddonAction, saveAreaAction, saveServiceAction } from "@/app/admin/actions/pricing";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAction } from "@/components/ui/useAction";
import { formatCents, parseMoneyToCents, centsToInput } from "@/lib/money";
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency } from "@/lib/pricing/rules";

type Service = { id: string; slug: string; name: string; short_description: string; description: string; includes: string[]; excludes: string[]; kind: string; allowed_frequencies: Frequency[]; requires_review: boolean; active: boolean; sort: number; priced: boolean };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function ServiceDialog({ s, open, onClose }: { s: Service | null; open: boolean; onClose: () => void }) {
  const blank: Service = { id: "", slug: "", name: "", short_description: "", description: "", includes: [], excludes: [], kind: "custom", allowed_frequencies: ["one_time"], requires_review: true, active: false, sort: 50, priced: false };
  const [v, setV] = useState<Service>(s ?? blank);
  const [inc, setInc] = useState((s?.includes ?? []).join("\n"));
  const [exc, setExc] = useState((s?.excludes ?? []).join("\n"));
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onClose={onClose} title={s ? `Edit ${s.name}` : "New service"} wide>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => saveServiceAction(s?.id ?? null, { ...v, includes: lines(inc), excludes: lines(exc) }), { onSuccess: onClose }); }}>
        <label><span className="field-label">Name</span><input className="input" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        {!s && <label><span className="field-label">Short code</span><input className="input" required pattern="[a-z0-9-]{2,40}" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /><span className="field-hint">Used internally, can&apos;t change later</span></label>}
        {!s && <label><span className="field-label">Type</span><select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{["recurring", "standard", "deep", "move", "turnover", "custom"].map((k) => <option key={k} value={k}>{k}</option>)}</select></label>}
        <label className="sm:col-span-2"><span className="field-label">Short description</span><input className="input" maxLength={300} value={v.short_description} onChange={(e) => setV({ ...v, short_description: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className="field-label">Full description</span><textarea className="input" rows={3} maxLength={3000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
        <label><span className="field-label">Includes <span className="font-normal text-muted">(one per line)</span></span><textarea className="input" rows={6} value={inc} onChange={(e) => setInc(e.target.value)} /></label>
        <label><span className="field-label">Not included <span className="font-normal text-muted">(one per line)</span></span><textarea className="input" rows={6} value={exc} onChange={(e) => setExc(e.target.value)} /></label>
        <fieldset className="sm:col-span-2"><legend className="field-label">Offered as</legend>
          <div className="flex flex-wrap gap-2">{FREQUENCIES.map((f) => (
            <label key={f} className="choice !min-h-10 !px-3 !py-2 text-sm"><input type="checkbox" checked={v.allowed_frequencies.includes(f)} onChange={(e) => setV({ ...v, allowed_frequencies: e.target.checked ? [...v.allowed_frequencies, f] : v.allowed_frequencies.filter((x) => x !== f) })} />{FREQUENCY_LABELS[f]}</label>
          ))}</div>
          <span className="field-hint">Each frequency also needs a price in the pricing draft.</span>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.requires_review} onChange={(e) => setV({ ...v, requires_review: e.target.checked })} />Always review before confirming</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Offered on the website</label>
        <label><span className="field-label">Display order</span><input className="input" type="number" min={0} max={999} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} /></label>
        <div className="flex gap-3 sm:col-span-2"><button className="btn btn-primary" disabled={pending}>Save service</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

export function ServicesEditor({ services }: { services: Service[] }) {
  const [edit, setEdit] = useState<Service | null | "new">(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit("new")}>New service</button></div>
      <ul className="grid gap-3 md:grid-cols-2">{services.map((s) => (
        <li key={s.id} className="card p-4">
          <div className="flex items-start justify-between gap-2"><div><p className="text-lg font-semibold">{s.name}</p><p className="text-xs text-muted">{s.allowed_frequencies.map((f) => FREQUENCY_LABELS[f]).join(", ")}{s.requires_review ? " · reviewed before confirming" : ""}</p></div>
            <StatusBadge status={s.active ? "active" : "inactive"} label={s.active ? "On website" : "Hidden"} /></div>
          <p className="mt-2 text-sm text-muted">{s.short_description}</p>
          {!s.priced && <p className="mt-1 text-xs font-semibold text-status-pending">No live price yet</p>}
          <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setEdit(s)}>Edit</button>
        </li>
      ))}</ul>
      {edit && <ServiceDialog key={edit === "new" ? "new" : edit.id} s={edit === "new" ? null : edit} open onClose={() => setEdit(null)} />}
    </div>
  );
}

type Addon = { id: string; slug: string; name: string; description: string; active: boolean; sort: number; price: string | null };
export function AddonsEditor({ addons }: { addons: Addon[] }) {
  const [edit, setEdit] = useState<Addon | null | "new">(null);
  const cur = edit === "new" ? { id: "", slug: "", name: "", description: "", active: false, sort: 50, price: null } : edit;
  const [v, setV] = useState<Addon | null>(null);
  const { run, pending } = useAction();
  const open = (a: Addon | "new") => { setEdit(a); setV(a === "new" ? { id: "", slug: "", name: "", description: "", active: false, sort: 50, price: null } : a); };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button type="button" className="btn btn-outline btn-sm" onClick={() => open("new")}>New add-on</button></div>
      <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Add-on</th><th>Live price</th><th>Status</th><th /></tr></thead><tbody>
        {addons.map((a) => <tr key={a.id}><td className="font-semibold">{a.name}<span className="block text-xs font-normal text-muted">{a.description}</span></td><td className="text-sm">{a.price ?? <span className="text-status-pending">Not priced</span>}</td><td><StatusBadge status={a.active ? "active" : "inactive"} label={a.active ? "Offered" : "Hidden"} /></td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => open(a)}>Edit</button></td></tr>)}
      </tbody></table></div>
      {cur && v && (
        <Dialog open onClose={() => setEdit(null)} title={edit === "new" ? "New add-on" : `Edit ${cur.name}`}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => saveAddonAction(edit === "new" ? null : cur.id, v), { onSuccess: () => setEdit(null) }); }}>
            <label className="block"><span className="field-label">Name</span><input className="input" required maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
            {edit === "new" && <label className="block"><span className="field-label">Short code</span><input className="input" required pattern="[a-z0-9-]{2,60}" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></label>}
            <label className="block"><span className="field-label">Description</span><textarea className="input" rows={2} maxLength={500} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Offered to customers</label>
            <label className="block"><span className="field-label">Display order</span><input className="input" type="number" min={0} max={999} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} /></label>
            <p className="text-xs text-muted">Prices live in the pricing draft so every change is versioned.</p>
            <div className="flex gap-3"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

type Area = { id: string; name: string; zip_codes: string[]; travel_fee_cents: number; requires_review: boolean; active: boolean; sort: number };
export function AreasEditor({ areas }: { areas: Area[] }) {
  const [edit, setEdit] = useState<Area | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [zips, setZips] = useState("");
  const [fee, setFee] = useState("");
  const { run, pending } = useAction();
  const open = (a: Area | null) => { const v = a ?? { id: "", name: "", zip_codes: [], travel_fee_cents: 0, requires_review: false, active: true, sort: 50 }; setIsNew(!a); setEdit(v); setZips(v.zip_codes.join(", ")); setFee(centsToInput(v.travel_fee_cents)); };
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button type="button" className="btn btn-outline btn-sm" onClick={() => open(null)}>New area</button></div>
      <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Area</th><th>ZIP codes</th><th>Travel fee</th><th>Status</th><th /></tr></thead><tbody>
        {areas.map((a) => <tr key={a.id}><td className="font-semibold">{a.name}</td><td className="max-w-80 text-xs">{a.zip_codes.join(", ")}</td><td className="text-sm">{a.travel_fee_cents ? formatCents(a.travel_fee_cents) : "None"}{a.requires_review ? <span className="block text-xs text-status-pending">Reviewed first</span> : null}</td><td><StatusBadge status={a.active ? "active" : "inactive"} /></td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => open(a)}>Edit</button></td></tr>)}
      </tbody></table></div>
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={isNew ? "New service area" : `Edit ${edit.name}`}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => saveAreaAction(isNew ? null : edit.id, { ...edit, zip_codes: zips.split(/[\s,]+/).filter(Boolean), travel_fee_cents: parseMoneyToCents(fee) ?? 0 }), { onSuccess: () => setEdit(null) }); }}>
            <label className="block"><span className="field-label">Name</span><input className="input" required maxLength={80} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="block"><span className="field-label">ZIP codes</span><textarea className="input" rows={3} value={zips} onChange={(e) => setZips(e.target.value)} /><span className="field-hint">Separate with commas or spaces.</span></label>
            <label className="block"><span className="field-label">Travel fee</span><input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.requires_review} onChange={(e) => setEdit({ ...edit, requires_review: e.target.checked })} />Review requests from this area before confirming</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active</label>
            <div className="flex gap-3"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
