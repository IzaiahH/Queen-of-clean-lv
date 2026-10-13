"use client";

import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addTimeOffAction, deleteTimeOffAction, saveCleanerAction, saveHoursAction } from "@/app/admin/actions/cleaners";
import { ConflictDialog } from "@/components/ui/ConflictDialog";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, parseMoneyToCents } from "@/lib/money";

export type CleanerValue = {
  full_name: string; email: string; phone: string; active: boolean; color: string; capabilities: string[]; worker_type: "unspecified" | "employee" | "contractor" | "owner" | "other";
  pay_method: "hourly" | "per_job" | "percent"; pay_rate_cents: number; pay_percent: number; max_jobs_per_day: number | null; private_notes: string;
};
export const EMPTY_CLEANER: CleanerValue = { full_name: "", email: "", phone: "", active: true, color: "#8E6B2E", capabilities: [], worker_type: "unspecified", pay_method: "hourly", pay_rate_cents: 0, pay_percent: 0, max_jobs_per_day: null, private_notes: "" };
const SWATCHES = ["#8E6B2E", "#2F5D62", "#6B4E71", "#3E6B48", "#A0522D", "#3B5B8C", "#8C3B4E", "#5C5C5C"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CleanerForm({ id, initial, services, canPay, onSaved }: { id: string | null; initial: CleanerValue; services: { slug: string; name: string }[]; canPay: boolean; onSaved?: (id: string) => void }) {
  const [v, setV] = useState(initial);
  const [rate, setRate] = useState(centsToInput(initial.pay_rate_cents));
  const { run, pending } = useAction();
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      run(() => saveCleanerAction(id, { ...v, pay_rate_cents: parseMoneyToCents(rate) ?? 0 }), { onSuccess: (r) => onSaved?.((r.data as { id: string }).id) });
    }}>
      <label><span className="field-label">Name</span><input className="input" required maxLength={120} value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></label>
      <label><span className="field-label">Phone</span><input className="input" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></label>
      <label><span className="field-label">Email</span><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
      <label><span className="field-label">Max jobs per day <span className="font-normal text-muted">(optional)</span></span><input className="input" type="number" min={1} max={12} value={v.max_jobs_per_day ?? ""} onChange={(e) => setV({ ...v, max_jobs_per_day: e.target.value ? Number(e.target.value) : null })} /></label>
      <fieldset className="sm:col-span-2"><legend className="field-label">Calendar color</legend>
        <div className="flex flex-wrap gap-2">{SWATCHES.map((c) => (
          <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={v.color === c} onClick={() => setV({ ...v, color: c })} className={`size-9 rounded-full border-2 ${v.color === c ? "border-obsidian ring-2 ring-gold" : "border-white"}`} style={{ background: c }} />
        ))}</div>
      </fieldset>
      <fieldset className="sm:col-span-2"><legend className="field-label">Can perform <span className="font-normal text-muted">(none checked = all services)</span></legend>
        <div className="flex flex-wrap gap-2">{services.map((s) => (
          <label key={s.slug} className="choice !min-h-10 !px-3 !py-2 text-sm"><input type="checkbox" checked={v.capabilities.includes(s.slug)} onChange={(e) => setV({ ...v, capabilities: e.target.checked ? [...v.capabilities, s.slug] : v.capabilities.filter((x) => x !== s.slug) })} />{s.name}</label>
        ))}</div>
      </fieldset>
      <label><span className="field-label">Worker type</span>
        <select className="input" value={v.worker_type} onChange={(e) => setV({ ...v, worker_type: e.target.value as "unspecified" })}>
          <option value="unspecified">Not specified</option><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="owner">Owner</option><option value="other">Other</option>
        </select>
        <span className="field-hint">For your records only. Check with an accountant on how workers should be classified.</span>
      </label>
      <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Active (can be booked)</label>
      {canPay ? (
        <fieldset className="grid gap-4 rounded-[var(--radius-control)] border border-line p-4 sm:col-span-2 sm:grid-cols-2"><legend className="px-1 text-sm font-semibold">Pay (owner/admin only)</legend>
          <label><span className="field-label">Pay method</span>
            <select className="input" value={v.pay_method} onChange={(e) => setV({ ...v, pay_method: e.target.value as "hourly" })}><option value="hourly">Hourly</option><option value="per_job">Per job</option><option value="percent">Percent of job revenue</option></select>
          </label>
          {v.pay_method === "percent"
            ? <label><span className="field-label">Percent</span><input className="input" type="number" min={0} max={100} step={0.5} value={v.pay_percent} onChange={(e) => setV({ ...v, pay_percent: Number(e.target.value) })} /></label>
            : <label><span className="field-label">{v.pay_method === "hourly" ? "Rate per hour" : "Amount per job"}</span><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>}
          <p className="text-xs text-muted sm:col-span-2">Used to calculate labor cost and job profit. Hourly pay uses the minutes each cleaner logs. Per-job pay goes to each cleaner on the job; percent pay is split between cleaners sharing a job.</p>
        </fieldset>
      ) : <p className="text-xs text-muted sm:col-span-2">Pay settings are visible to the owner and administrators only.</p>}
      <label className="sm:col-span-2"><span className="field-label">Private notes</span><textarea className="input" rows={2} maxLength={3000} value={v.private_notes} onChange={(e) => setV({ ...v, private_notes: e.target.value })} /></label>
      <div className="sm:col-span-2"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : id ? "Save cleaner" : "Add cleaner"}</button></div>
    </form>
  );
}

export function NewCleanerButton({ services, canPay }: { services: { slug: string; name: string }[]; canPay: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Add cleaner</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Add cleaner" wide>
        <CleanerForm id={null} initial={EMPTY_CLEANER} services={services} canPay={canPay} onSaved={(id) => { setOpen(false); router.push(`/admin/cleaners/${id}`); }} />
      </Dialog>
    </>
  );
}

type Shift = { weekday: number; start_time: string; end_time: string };
export function HoursEditor({ cleanerId, initial }: { cleanerId: string; initial: Shift[] }) {
  const [rows, setRows] = useState<Shift[]>(initial);
  const { run, pending } = useAction();
  const add = (weekday: number) => setRows([...rows, { weekday, start_time: "08:00", end_time: "16:00" }]);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line">
        {DAYS.map((d, i) => {
          const wd = i + 1;
          const shifts = rows.map((r, idx) => ({ ...r, idx })).filter((r) => r.weekday === wd);
          return (
            <li key={d} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-12 text-sm font-semibold">{d}</span>
              {shifts.length === 0 && <span className="text-sm text-muted">Off</span>}
              {shifts.map((s) => (
                <span key={s.idx} className="inline-flex items-center gap-1">
                  <input aria-label={`${d} start`} type="time" step={900} className="input !min-h-9 w-28 !py-1" value={s.start_time} onChange={(e) => setRows(rows.map((r, j) => (j === s.idx ? { ...r, start_time: e.target.value } : r)))} />
                  <span aria-hidden>–</span>
                  <input aria-label={`${d} end`} type="time" step={900} className="input !min-h-9 w-28 !py-1" value={s.end_time} onChange={(e) => setRows(rows.map((r, j) => (j === s.idx ? { ...r, end_time: e.target.value } : r)))} />
                  <button type="button" className="btn btn-ghost size-9 p-0" aria-label={`Remove ${d} shift`} onClick={() => setRows(rows.filter((_, j) => j !== s.idx))}><Trash2 className="size-4" aria-hidden /></button>
                </span>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => add(wd)}><Plus className="size-4" aria-hidden />{shifts.length ? "Split shift" : "Add hours"}</button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => saveHoursAction(cleanerId, rows))}>Save hours</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows([1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: "08:00", end_time: "17:00" })))}>Fill Mon–Fri 8–5</button>
      </div>
    </div>
  );
}

export function TimeOffEditor({ cleanerId, items, tz }: { cleanerId: string; items: { id: string; starts_at: Date | string; ends_at: Date | string; reason: string }[]; tz: string }) {
  const today = DateTime.now().setZone(tz).toISODate()!;
  const [s, setS] = useState(today);
  const [e, setE] = useState(today);
  const [reason, setReason] = useState("");
  const { run, pending, conflicts, clearConflicts } = useAction();
  const fmt = (d: Date | string) => DateTime.fromJSDate(new Date(d)).setZone(tz).toFormat("ccc, LLL d");
  return (
    <div className="space-y-3">
      {items.length === 0 ? <p className="text-sm text-muted">No time off scheduled.</p> : (
        <ul className="divide-y divide-line text-sm">{items.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2"><span>{fmt(t.starts_at)}{fmt(t.ends_at) !== fmt(t.starts_at) ? ` – ${fmt(t.ends_at)}` : ""}{t.reason ? <span className="text-muted"> · {t.reason}</span> : null}</span>
            <button type="button" className="btn btn-ghost btn-sm text-danger" disabled={pending} onClick={() => run(() => deleteTimeOffAction(t.id))}>Remove</button></li>
        ))}</ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
        <label><span className="field-label">From</span><input type="date" className="input" value={s} min={today} onChange={(ev) => { setS(ev.target.value); if (ev.target.value > e) setE(ev.target.value); }} /></label>
        <label><span className="field-label">To</span><input type="date" className="input" value={e} min={s} onChange={(ev) => setE(ev.target.value)} /></label>
        <label><span className="field-label">Reason <span className="font-normal text-muted">(private)</span></span><input className="input" maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
        <button type="button" className="btn btn-dark" disabled={pending} onClick={() => run((force) => addTimeOffAction(cleanerId, s, e, reason, force), { onSuccess: () => setReason("") })}>Add time off</button>
      </div>
      <ConflictDialog conflicts={conflicts} onCancel={clearConflicts} />
    </div>
  );
}
