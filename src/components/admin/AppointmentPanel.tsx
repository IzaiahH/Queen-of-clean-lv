"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, Clock, ExternalLink, Mail, MapPin, Phone, Repeat, User } from "lucide-react";
import { DateTime } from "luxon";
import type { getAppointmentDetail } from "@/lib/server/admin-queries";
import {
  assignAction, cancelAction, completeAction, confirmAction, declineAction, noShowAction, reopenAction, rescheduleAction,
  resolveRequestAction, retryEmailAction, sendConfirmationAction, seriesStatusAction, startSeriesFromAppointmentAction, updateFieldsAction, updateSeriesAction,
} from "@/app/admin/actions/appointments";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { ConflictDialog } from "@/components/ui/ConflictDialog";
import { Dialog } from "@/components/ui/Dialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";
import { frequencyLabel, type RecurrenceFrequency } from "@/lib/scheduling/recurrence";
import { minutesLabel } from "@/lib/time";

export type AppointmentDetail = NonNullable<Awaited<ReturnType<typeof getAppointmentDetail>>>;
export type CleanerOption = { id: string; full_name: string; color: string };

const fmt = (d: Date | string, tz: string, f = "ccc, LLL d · h:mm a") => DateTime.fromJSDate(new Date(d)).setZone(tz).toFormat(f);
const toLocalInput = (d: Date | string, tz: string) => DateTime.fromJSDate(new Date(d)).setZone(tz).toFormat("yyyy-LL-dd'T'HH:mm");
const fromLocalInput = (v: string, tz: string) => DateTime.fromISO(v, { zone: tz }).toUTC().toISO()!;

export function AppointmentPanel({ detail, cleaners, tz, canMoney, defaultChecklist, onChanged }: {
  detail: AppointmentDetail; cleaners: CleanerOption[]; tz: string; canMoney: boolean; defaultChecklist: string[]; onChanged?: () => void;
}) {
  const { a, assignments, series } = detail;
  const { run, pending, conflicts, clearConflicts } = useAction();
  const [dialog, setDialog] = useState<null | "reschedule" | "assign" | "complete" | "series" | "start-series" | "notes">(null);
  const [notify, setNotify] = useState(true);
  const done = () => { setDialog(null); onChanged?.(); };
  const open = ["pending", "confirmed"].includes(a.status);
  const started = new Date(a.starts_at) <= new Date();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">{a.reference} · {a.source === "website" ? "Online request" : a.source === "recurring" ? "Recurring" : "Added by staff"}</p>
          <p className="mt-1 text-xl font-semibold">{fmt(a.starts_at, tz)} – {fmt(a.ends_at, tz, "h:mm a")}</p>
          <p className="text-sm text-muted">{a.service_name} · {minutesLabel(a.estimated_minutes)}{a.actual_minutes ? ` (actual ${minutesLabel(a.actual_minutes)})` : ""}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {(a.needs_attention || detail.requests.some((r) => r.status === "open")) && (
        <div className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-3 text-sm text-status-pending">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" aria-hidden />{a.needs_attention ?? "Customer request"}</p>
          {detail.requests.filter((r) => r.status === "open").map((r) => (
            <div key={r.id} className="mt-2 text-charcoal">
              <p>Customer asked to <strong>{r.kind}</strong>{r.requested_starts_at ? ` → ${fmt(r.requested_starts_at, tz)}` : ""}.{r.message ? ` “${r.message}”` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.kind === "reschedule" && r.requested_starts_at && (
                  <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={() => run((force) => rescheduleAction(a.id, new Date(r.requested_starts_at!).toISOString(), null, force, true), { onSuccess: done })}>Approve new time</button>
                )}
                {r.kind === "cancel" && <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={() => run(() => cancelAction(a.id, `Customer cancellation: ${r.message}`, true), { onSuccess: done })}>Approve cancellation</button>}
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => resolveRequestAction(r.id, "denied"), { onSuccess: done })}>Decline request</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {a.status === "pending" && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => confirmAction(a.id, notify), { onSuccess: done })}><Check className="size-4" aria-hidden />Confirm</button>
            <ConfirmButton label="Decline" title="Decline this request?" body="The customer's requested time will be released." confirmLabel="Decline request" danger withReason reasonLabel="Message to the customer (optional)" onConfirm={(m) => run(() => declineAction(a.id, m, notify), { onSuccess: done })} />
          </>
        )}
        {open && <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog("reschedule")}><CalendarClock className="size-4" aria-hidden />Reschedule</button>}
        {a.status !== "cancelled" && a.status !== "declined" && <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog("assign")}><User className="size-4" aria-hidden />Assign cleaner</button>}
        {(open || a.status === "completed") && started && (
          <button type="button" className="btn btn-dark btn-sm" onClick={() => setDialog("complete")}><Check className="size-4" aria-hidden />{a.status === "completed" ? "Edit job record" : "Mark complete"}</button>
        )}
        {a.status === "confirmed" && !started && a.customer_email && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => sendConfirmationAction(a.id))}><Mail className="size-4" aria-hidden />Email confirmation</button>}
        {a.status === "confirmed" && !a.series_id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog("start-series")}><Repeat className="size-4" aria-hidden />Make recurring</button>}
        {open && a.series_id && (
          <ConfirmButton label="Skip this visit" title="Skip this visit?" body="Only this visit is cancelled. The rest of the recurring schedule stays the same." confirmLabel="Skip visit" withReason reasonLabel="Reason (optional)" onConfirm={(m) => run(() => cancelAction(a.id, m, notify, true), { onSuccess: done })} />
        )}
        {open && <ConfirmButton label="Cancel" className="btn btn-ghost btn-sm text-danger" title="Cancel this appointment?" body={a.series_id ? "Only this visit is cancelled. To stop all future visits, cancel the recurring schedule instead." : "The time will be released for other bookings."} confirmLabel="Cancel appointment" danger withReason reasonLabel="Reason (shared with the customer if notified)" onConfirm={(m) => run(() => cancelAction(a.id, m, notify), { onSuccess: done })} />}
        {a.status === "confirmed" && started && <ConfirmButton label="No-show" className="btn btn-ghost btn-sm" title="Mark as no-show / lockout?" body="Use this when the team couldn't access the home." confirmLabel="Mark no-show" onConfirm={() => run(() => noShowAction(a.id), { onSuccess: done })} />}
        {["cancelled", "declined", "no_show"].includes(a.status) && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => reopenAction(a.id), { onSuccess: done })}>Reopen</button>}
      </div>
      {open && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-gold)]" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer about changes {a.customer_email ? "" : "(no email on file)"}
        </label>
      )}

      {/* Customer & property */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] border border-line p-4 text-sm">
          <p className="eyebrow">Customer</p>
          <Link href={`/admin/customers/${a.customer_id}`} className="mt-1 inline-flex items-center gap-1 text-base font-semibold hover:text-gold-ink">{a.customer_name}<ExternalLink className="size-3.5" aria-hidden /></Link>
          {a.customer_phone && <p className="mt-1 flex items-center gap-2"><Phone className="size-3.5 text-muted" aria-hidden /><a href={`tel:${a.customer_phone}`}>{a.customer_phone}</a></p>}
          {a.customer_email && <p className="flex items-center gap-2"><Mail className="size-3.5 text-muted" aria-hidden /><a href={`mailto:${a.customer_email}`} className="break-all">{a.customer_email}</a></p>}
          <p className="text-xs text-muted">Prefers {a.preferred_contact}</p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-line p-4 text-sm">
          <p className="eyebrow">Property</p>
          <p className="mt-1 flex gap-2"><MapPin className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />{a.address}{a.area ? ` · ${a.area}` : ""}</p>
          <p className="text-muted">{a.bedrooms ?? "?"} bed · {a.full_baths ?? "?"} bath{a.half_baths ? ` · ${a.half_baths} half` : ""}{a.sqft ? ` · ${a.sqft.toLocaleString()} sq ft` : ""}</p>
          {a.pets && <p className="text-muted">Pets: {a.pets}</p>}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] border border-line p-4 text-sm">
          <p className="eyebrow">Cleaners</p>
          {assignments.length === 0 ? <p className="mt-1 font-semibold text-status-pending">No cleaner assigned</p> : (
            <ul className="mt-1 space-y-1">{assignments.map((c) => <li key={c.cleaner_id} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />{c.full_name}</li>)}</ul>
          )}
        </div>
        <div className="rounded-[var(--radius-control)] border border-line p-4 text-sm">
          <p className="eyebrow">Price</p>
          <p className="mt-1 text-base font-semibold">{formatCents(a.agreed_price_cents)} <span className="text-xs font-normal text-muted">{a.status === "completed" ? "agreed" : "agreed / estimated"}</span></p>
          {a.quote_reference && <p className="text-xs text-muted">Quote {a.quote_reference}: {formatCents(a.quote_override_cents ?? a.quote_estimate_cents)} ({a.quote_status})</p>}
          <p className="text-xs text-muted">Payment: {a.payment_status.replace("_", " ")}</p>
          {canMoney && a.status !== "completed" && detail.estimatedLabor > 0 && <p className="text-xs text-muted">Est. labor cost {formatCents(detail.estimatedLabor)}</p>}
        </div>
      </section>

      {a.addons.length > 0 && (
        <section className="text-sm"><p className="eyebrow">Add-ons</p><ul className="mt-1 list-disc pl-5">{a.addons.map((x, i) => <li key={i}>{x.label} — {formatCents(x.amount_cents)}</li>)}</ul></section>
      )}

      <section className="space-y-3 text-sm">
        <div className="flex items-center justify-between"><p className="eyebrow">Notes &amp; access</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog("notes")}>Edit</button></div>
        <NoteBlock title="Access instructions (private)" text={a.access_instructions || a.property_access} />
        <NoteBlock title="Internal notes (staff only)" text={a.internal_notes} />
        <NoteBlock title="Customer notes (visible to customer)" text={a.customer_notes} />
        {a.scheduling_preferences && <NoteBlock title="Scheduling preferences" text={a.scheduling_preferences} />}
      </section>

      {series && (
        <section className="rounded-[var(--radius-control)] border border-gold/50 bg-cream/40 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold"><Repeat className="size-4 text-gold" aria-hidden />Recurring: {frequencyLabel(series.frequency as RecurrenceFrequency, series.interval_days)} at {series.start_time.slice(0, 5)} · {formatCents(series.price_cents)} <StatusBadge status={series.status} /></p>
          {a.is_exception && <p className="mt-1 text-xs text-muted">This visit was edited individually; series changes won&apos;t overwrite it.</p>}
          {series.status !== "cancelled" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog("series")}>Edit schedule…</button>
              {series.status === "active" ? (
                <ConfirmButton label="Pause" title="Pause this recurring schedule?" body="Upcoming generated visits are removed until you resume. Visits you edited individually are kept." confirmLabel="Pause schedule" onConfirm={() => run(() => seriesStatusAction(series.id, "paused"), { onSuccess: done })} />
              ) : (
                <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => seriesStatusAction(series.id, "active"), { onSuccess: done })}>Resume</button>
              )}
              <ConfirmButton label="Cancel schedule" className="btn btn-ghost btn-sm text-danger" title="Cancel the whole recurring schedule?" body="All upcoming visits in this schedule will be cancelled. Past visits are kept." confirmLabel="Cancel schedule" danger onConfirm={() => run(() => seriesStatusAction(series.id, "cancelled"), { onSuccess: done })} />
            </div>
          )}
        </section>
      )}

      {detail.job && (
        <section className="rounded-[var(--radius-control)] border border-status-completed/40 p-4 text-sm">
          <p className="eyebrow">Job record</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted">Revenue recorded</dt><dd className="text-right font-semibold">{formatCents(detail.job.revenue_cents)}</dd>
            {canMoney && <><dt className="text-muted">Cleaner labor</dt><dd className="text-right">{formatCents(detail.laborCents)}</dd></>}
            <dt className="text-muted">Supplies</dt><dd className="text-right">{formatCents(detail.job.supplies_cents)}</dd>
            <dt className="text-muted">Other job costs</dt><dd className="text-right">{formatCents(detail.job.other_cost_cents)}</dd>
            {canMoney && detail.profit && <><dt className="font-semibold">Job profit</dt><dd className="text-right font-semibold">{formatCents(detail.profit.profit_cents)}{detail.profit.margin_pct !== null ? ` (${detail.profit.margin_pct}%)` : ""}</dd></>}
          </dl>
          {canMoney && detail.labor.map((l) => <p key={l.cleaner_id} className="mt-1 text-xs text-muted">{l.full_name}: {minutesLabel(l.minutes)} · {l.pay_basis} = {formatCents(l.pay_cents)}</p>)}
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">History &amp; communications ({detail.changes.length + detail.comms.length})</summary>
        <ul className="mt-3 space-y-2">
          {detail.comms.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-cream/50 p-2">
              <Mail className="size-3.5 text-muted" aria-hidden /><span className="font-semibold">{c.subject}</span><StatusBadge status={c.status} />
              <span className="text-xs text-muted">to {c.recipient} · {fmt(c.created_at, tz, "LLL d, h:mm a")}{c.error ? ` · ${c.error}` : ""}</span>
              {["failed", "skipped"].includes(c.status) && <button type="button" className="btn btn-ghost btn-sm ml-auto" disabled={pending} onClick={() => run(() => retryEmailAction(c.id))}>Retry</button>}
            </li>
          ))}
          {detail.changes.map((c) => (
            <li key={c.id} className="flex gap-2"><Clock className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden /><span><strong>{c.kind.replace("_", " ")}</strong> by {c.actor_label} · {fmt(c.created_at, tz, "LLL d, h:mm a")}{c.note ? ` — ${c.note}` : ""}</span></li>
          ))}
        </ul>
      </details>

      <RescheduleDialog open={dialog === "reschedule"} onClose={() => setDialog(null)} a={a} tz={tz} onSave={(start, dur) => run((force) => rescheduleAction(a.id, start, dur, force, notify), { onSuccess: done })} pending={pending} />
      <AssignDialog open={dialog === "assign"} onClose={() => setDialog(null)} cleaners={cleaners} current={assignments.map((x) => x.cleaner_id)} onSave={(ids) => run((force) => assignAction(a.id, ids, force), { onSuccess: done })} pending={pending} />
      <CompleteDialog open={dialog === "complete"} onClose={() => setDialog(null)} detail={detail} tz={tz} defaultChecklist={defaultChecklist} onSave={(input) => run(() => completeAction(a.id, input), { onSuccess: done })} pending={pending} />
      <NotesDialog open={dialog === "notes"} onClose={() => setDialog(null)} a={a} onSave={(f) => run(() => updateFieldsAction(a.id, f), { onSuccess: done })} pending={pending} canMoney={canMoney} />
      {series && <SeriesDialog open={dialog === "series"} onClose={() => setDialog(null)} series={series} occurrenceDate={a.occurrence_date} cleaners={cleaners} onSave={(scope, changes) => run(() => updateSeriesAction(series.id, scope, a.occurrence_date, changes), { onSuccess: done })} pending={pending} />}
      <StartSeriesDialog open={dialog === "start-series"} onClose={() => setDialog(null)} price={a.agreed_price_cents} frequency={a.frequency} onSave={(input) => run(() => startSeriesFromAppointmentAction(a.id, input), { onSuccess: done })} pending={pending} />
      <ConflictDialog conflicts={conflicts} onCancel={clearConflicts} />
    </div>
  );
}

function NoteBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-muted">{title}</p>
      <p className="whitespace-pre-line">{text || <span className="text-muted">—</span>}</p>
    </div>
  );
}

function RescheduleDialog({ open, onClose, a, tz, onSave, pending }: { open: boolean; onClose: () => void; a: AppointmentDetail["a"]; tz: string; onSave: (start: string, duration: number) => void; pending: boolean }) {
  const [start, setStart] = useState(toLocalInput(a.starts_at, tz));
  const [dur, setDur] = useState(String(Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000)));
  return (
    <Dialog open={open} onClose={onClose} title="Reschedule">
      <div className="space-y-4">
        <label className="block"><span className="field-label">New start (Las Vegas time)</span><input type="datetime-local" className="input" value={start} step={900} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="block"><span className="field-label">Duration (minutes)</span><input type="number" min={15} max={960} step={15} className="input" value={dur} onChange={(e) => setDur(e.target.value)} /></label>
        {a.series_id && <p className="text-sm text-muted">Only this visit moves. To move every visit, edit the recurring schedule.</p>}
        <p className="text-sm text-muted">We check for conflicts before saving.</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-dark" disabled={pending || !start} onClick={() => onSave(fromLocalInput(start, tz), Number(dur))}>Save new time</button></div>
      </div>
    </Dialog>
  );
}

function AssignDialog({ open, onClose, cleaners, current, onSave, pending }: { open: boolean; onClose: () => void; cleaners: CleanerOption[]; current: string[]; onSave: (ids: string[]) => void; pending: boolean }) {
  const [sel, setSel] = useState<string[]>(current);
  return (
    <Dialog open={open} onClose={onClose} title="Assign cleaners">
      {cleaners.length === 0 ? <p className="text-sm">No active cleaners yet. <Link href="/admin/cleaners" className="underline">Add one</Link>.</p> : (
        <fieldset className="space-y-2">
          <legend className="sr-only">Cleaners</legend>
          {cleaners.map((c) => (
            <label key={c.id} className="choice items-center py-3">
              <input type="checkbox" className="size-4 accent-[var(--color-gold)]" checked={sel.includes(c.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
              <span className="size-3 rounded-full" style={{ background: c.color }} aria-hidden />
              <span className="font-semibold">{c.full_name}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-dark" disabled={pending} onClick={() => onSave(sel)}>Save</button></div>
    </Dialog>
  );
}

function CompleteDialog({ open, onClose, detail, tz, defaultChecklist, onSave, pending }: {
  open: boolean; onClose: () => void; detail: AppointmentDetail; tz: string; defaultChecklist: string[]; pending: boolean;
  onSave: (input: Parameters<typeof completeAction>[1]) => void;
}) {
  const { a, assignments, job, labor } = detail;
  const checklist = useMemo(() => (a.checklist.length ? a.checklist : defaultChecklist), [a.checklist, defaultChecklist]);
  const [revenue, setRevenue] = useState(centsToInput(job?.revenue_cents ?? a.agreed_price_cents));
  const [supplies, setSupplies] = useState(centsToInput(job?.supplies_cents ?? 0));
  const [other, setOther] = useState(centsToInput(job?.other_cost_cents ?? 0));
  const [actual, setActual] = useState(String(a.actual_minutes ?? a.estimated_minutes));
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [done, setDone] = useState<string[]>(job?.checklist_done ?? []);
  const [crew, setCrew] = useState(() =>
    assignments.map((c) => {
      const l = labor.find((x) => x.cleaner_id === c.cleaner_id);
      return { cleaner_id: c.cleaner_id, name: c.full_name, minutes: String(l?.minutes ?? a.actual_minutes ?? a.estimated_minutes), clock_in: l?.clock_in ? toLocalInput(l.clock_in, tz) : "", clock_out: l?.clock_out ? toLocalInput(l.clock_out, tz) : "" };
    }),
  );
  const [err, setErr] = useState("");
  const submit = () => {
    const rev = parseMoneyToCents(revenue);
    const sup = parseMoneyToCents(supplies || "0");
    const oth = parseMoneyToCents(other || "0");
    if (rev === null || sup === null || oth === null) return setErr("Enter dollar amounts like 185 or 185.50");
    if (!/^\d+$/.test(actual)) return setErr("Enter the actual duration in minutes");
    for (const c of crew) {
      if (c.clock_in && c.clock_out && c.clock_out <= c.clock_in) return setErr(`${c.name}: clock-out must be after clock-in`);
    }
    setErr("");
    onSave({
      actual_minutes: Number(actual), revenue_cents: rev, supplies_cents: sup, other_cost_cents: oth, notes, checklist_done: done,
      labor: crew.map((c) => {
        const mins = c.clock_in && c.clock_out ? Math.round((DateTime.fromISO(c.clock_out).toMillis() - DateTime.fromISO(c.clock_in).toMillis()) / 60000) : Number(c.minutes) || 0;
        return { cleaner_id: c.cleaner_id, minutes: mins, clock_in: c.clock_in ? fromLocalInput(c.clock_in, tz) : null, clock_out: c.clock_out ? fromLocalInput(c.clock_out, tz) : null };
      }),
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title={a.status === "completed" ? "Edit job record" : "Complete job"} side>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="field-label">Amount charged ($)</span><input className="input" inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} /></label>
          <label className="block"><span className="field-label">Actual duration (min)</span><input className="input" inputMode="numeric" value={actual} onChange={(e) => setActual(e.target.value)} /></label>
          <label className="block"><span className="field-label">Supplies used ($)</span><input className="input" inputMode="decimal" value={supplies} onChange={(e) => setSupplies(e.target.value)} /></label>
          <label className="block"><span className="field-label">Other job costs ($)</span><input className="input" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} /></label>
        </div>
        <fieldset>
          <legend className="field-label">Cleaner time</legend>
          {crew.length === 0 && <p className="text-sm text-status-pending">No cleaner is assigned, so no labor cost will be recorded. Assign the cleaner first if one did the job.</p>}
          <div className="space-y-3">
            {crew.map((c, i) => (
              <div key={c.cleaner_id} className="rounded-[var(--radius-control)] border border-line p-3">
                <p className="font-semibold">{c.name}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <label className="text-xs">Minutes<input className="input" inputMode="numeric" value={c.minutes} disabled={Boolean(c.clock_in && c.clock_out)} onChange={(e) => setCrew((all) => all.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))} /></label>
                  <label className="text-xs">Clock in<input type="datetime-local" className="input" value={c.clock_in} onChange={(e) => setCrew((all) => all.map((x, j) => (j === i ? { ...x, clock_in: e.target.value } : x)))} /></label>
                  <label className="text-xs">Clock out<input type="datetime-local" className="input" value={c.clock_out} onChange={(e) => setCrew((all) => all.map((x, j) => (j === i ? { ...x, clock_out: e.target.value } : x)))} /></label>
                </div>
              </div>
            ))}
          </div>
          <p className="field-hint">Pay is calculated from each cleaner&apos;s pay settings when you save.</p>
        </fieldset>
        {checklist.length > 0 && (
          <fieldset>
            <legend className="field-label">Completion checklist</legend>
            <div className="space-y-1.5">
              {checklist.map((item) => (
                <label key={item} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-gold)]" checked={done.includes(item)} onChange={(e) => setDone((d) => (e.target.checked ? [...d, item] : d.filter((x) => x !== item)))} />{item}</label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="block"><span className="field-label">Job notes</span><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>Save job record</button></div>
      </div>
    </Dialog>
  );
}

function NotesDialog({ open, onClose, a, onSave, pending, canMoney }: { open: boolean; onClose: () => void; a: AppointmentDetail["a"]; pending: boolean; canMoney: boolean; onSave: (f: Parameters<typeof updateFieldsAction>[1]) => void }) {
  const [f, setF] = useState({ internal_notes: a.internal_notes, customer_notes: a.customer_notes, access_instructions: a.access_instructions || a.property_access, price: centsToInput(a.agreed_price_cents), payment_status: a.payment_status });
  const [err, setErr] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title="Edit details" side>
      <div className="space-y-4">
        <label className="block"><span className="field-label">Agreed price ($)</span><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /><span className="field-hint">Changing the price is recorded in the history.{a.series_id ? " This changes only this visit." : ""}</span></label>
        {canMoney && (
          <label className="block"><span className="field-label">Payment status</span>
            <select className="input" value={f.payment_status} onChange={(e) => setF({ ...f, payment_status: e.target.value })}>
              <option value="unpaid">Unpaid</option><option value="partial">Partially paid</option><option value="paid">Paid</option><option value="not_tracked">Not tracked</option>
            </select>
          </label>
        )}
        <label className="block"><span className="field-label">Access instructions (private)</span><textarea className="input" value={f.access_instructions} onChange={(e) => setF({ ...f, access_instructions: e.target.value })} /></label>
        <label className="block"><span className="field-label">Internal notes (staff only)</span><textarea className="input" value={f.internal_notes} onChange={(e) => setF({ ...f, internal_notes: e.target.value })} /></label>
        <label className="block"><span className="field-label">Customer notes (customer can see)</span><textarea className="input" value={f.customer_notes} onChange={(e) => setF({ ...f, customer_notes: e.target.value })} /></label>
        {err && <p className="field-error">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-dark" disabled={pending} onClick={() => {
            const cents = parseMoneyToCents(f.price);
            if (cents === null) return setErr("Enter a valid price");
            onSave({ internal_notes: f.internal_notes, customer_notes: f.customer_notes, access_instructions: f.access_instructions, agreed_price_cents: cents, payment_status: canMoney ? (f.payment_status as "unpaid") : undefined });
          }}>Save</button></div>
      </div>
    </Dialog>
  );
}

function SeriesDialog({ open, onClose, series, occurrenceDate, cleaners, onSave, pending }: {
  open: boolean; onClose: () => void; series: NonNullable<AppointmentDetail["series"]>; occurrenceDate: string | null; cleaners: CleanerOption[]; pending: boolean;
  onSave: (scope: "future" | "all", changes: Parameters<typeof updateSeriesAction>[3]) => void;
}) {
  const [scope, setScope] = useState<"future" | "all">(occurrenceDate ? "future" : "all");
  const [freq, setFreq] = useState(series.frequency as RecurrenceFrequency);
  const [interval, setInterval] = useState(String(series.interval_days ?? 21));
  const [time, setTime] = useState(series.start_time.slice(0, 5));
  const [dur, setDur] = useState(String(series.duration_minutes));
  const [price, setPrice] = useState(centsToInput(series.price_cents));
  const [crew, setCrew] = useState<string[]>(series.cleaner_ids);
  const [err, setErr] = useState("");
  return (
    <Dialog open={open} onClose={onClose} title="Edit recurring schedule" side>
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="field-label">Apply changes to</legend>
          {occurrenceDate && <label className="choice py-3"><input type="radio" name="scope" checked={scope === "future"} onChange={() => setScope("future")} className="mt-1 accent-[var(--color-gold)]" /><span className="text-sm"><strong>This visit and all future visits</strong><br />Earlier visits keep the old schedule and price.</span></label>}
          <label className="choice py-3"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} className="mt-1 accent-[var(--color-gold)]" /><span className="text-sm"><strong>All upcoming visits in the series</strong><br />Completed and past visits never change.</span></label>
        </fieldset>
        <p className="rounded-[var(--radius-control)] bg-cream/60 p-3 text-sm">Upcoming visits generated from this schedule will be replaced with the new pattern. Visits you edited one by one (moved or re-priced) are kept as they are. To change only one visit, close this and use Reschedule or Edit details.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="field-label">Frequency</span>
            <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFrequency)}>
              <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="custom">Custom interval</option>
            </select>
          </label>
          {freq === "custom" && <label className="block"><span className="field-label">Every N days</span><input className="input" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} /></label>}
          <label className="block"><span className="field-label">Start time</span><input type="time" className="input" value={time} step={900} onChange={(e) => setTime(e.target.value)} /></label>
          <label className="block"><span className="field-label">Duration (min)</span><input className="input" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} /></label>
          <label className="block"><span className="field-label">Price per visit ($)</span><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        </div>
        <fieldset><legend className="field-label">Cleaners</legend>
          <div className="flex flex-wrap gap-2">{cleaners.map((c) => <label key={c.id} className="choice px-3 py-2 text-sm"><input type="checkbox" className="accent-[var(--color-gold)]" checked={crew.includes(c.id)} onChange={(e) => setCrew((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />{c.full_name}</label>)}</div>
        </fieldset>
        {err && <p className="field-error">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-dark" disabled={pending} onClick={() => {
            const cents = parseMoneyToCents(price);
            if (cents === null || !/^\d+$/.test(dur)) return setErr("Check the price and duration");
            onSave(scope, { frequency: freq, interval_days: freq === "custom" ? Number(interval) : null, start_time: time, duration_minutes: Number(dur), price_cents: cents, cleaner_ids: crew });
          }}>Apply changes</button></div>
      </div>
    </Dialog>
  );
}

function StartSeriesDialog({ open, onClose, price, frequency, onSave, pending }: { open: boolean; onClose: () => void; price: number; frequency: string; pending: boolean; onSave: (i: { frequency: RecurrenceFrequency; interval_days: number | null; price_cents: number }) => void }) {
  const [freq, setFreq] = useState<RecurrenceFrequency>(["weekly", "biweekly", "monthly", "quarterly"].includes(frequency) ? (frequency as RecurrenceFrequency) : "biweekly");
  const [interval, setInterval] = useState("21");
  const [p, setP] = useState(centsToInput(price));
  return (
    <Dialog open={open} onClose={onClose} title="Make this a recurring schedule">
      <div className="space-y-4">
        <p className="text-sm text-muted">This visit becomes the first in the series. Future visits are created at the same weekday and time, up to your scheduling horizon, and checked for conflicts.</p>
        <label className="block"><span className="field-label">Frequency</span>
          <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFrequency)}>
            <option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="custom">Custom interval</option>
          </select>
        </label>
        {freq === "custom" && <label className="block"><span className="field-label">Every N days</span><input className="input" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} /></label>}
        <label className="block"><span className="field-label">Price per visit ($)</span><input className="input" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></label>
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="btn btn-dark" disabled={pending} onClick={() => onSave({ frequency: freq, interval_days: freq === "custom" ? Number(interval) : null, price_cents: parseMoneyToCents(p) ?? price })}>Create schedule</button></div>
      </div>
    </Dialog>
  );
}
