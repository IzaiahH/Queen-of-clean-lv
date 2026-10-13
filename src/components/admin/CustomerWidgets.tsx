"use client";

import { DateTime } from "luxon";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { searchCustomersAction } from "@/app/admin/actions/calendar";
import {
  contactMessageStatusAction, contactToCustomerAction, deletePaymentAction, mergeCustomersAction, recordPaymentAction, saveCustomerStatusAction,
} from "@/app/admin/actions/customers";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { parseMoneyToCents } from "@/lib/money";
import type { CleanerOption } from "./AppointmentPanel";
import { NewAppointmentDialog, type ServiceOption } from "./NewAppointmentDialog";

type Hit = { id: string; full_name: string; email: string | null; phone: string | null; properties: { id: string; label: string; address: string | null; has_address: boolean }[]; last_price: number | null; last_minutes: number | null };

export function BookFromProfile({ customer, tz, services, cleaners }: { customer: Hit; tz: string; services: ServiceOption[]; cleaners: CleanerOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={!customer.properties.length} title={customer.properties.length ? undefined : "Add a property first"}>
        <CalendarPlus className="size-4" aria-hidden />Book cleaning
      </button>
      <NewAppointmentDialog open={open} onClose={() => setOpen(false)} tz={tz} services={services} cleaners={cleaners} customer={customer} />
    </>
  );
}

export function CustomerStatusButtons({ id, status }: { id: string; status: string }) {
  const { run, pending } = useAction();
  if (status === "archived")
    return <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => saveCustomerStatusAction(id, "active"))}>Restore</button>;
  return (
    <ConfirmButton label="Archive" title="Archive this customer?" confirmLabel="Archive" danger
      body={<p>They&apos;ll be hidden from lists and search. Appointments, quotes and money history are kept, and you can restore them any time. Future appointments are not cancelled automatically.</p>}
      onConfirm={() => run(() => saveCustomerStatusAction(id, "archived"))} className="btn btn-ghost btn-sm text-danger" disabled={pending} />
  );
}

export function MergeButton({ keepId, keepName, suggestions }: { keepId: string; keepName: string; suggestions: { id: string; full_name: string; email: string | null; reason: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setHits] = useState<{ id: string; full_name: string; email: string | null }[]>([]);
  const [target, setTarget] = useState<{ id: string; full_name: string; email: string | null } | null>(null);
  const { run, pending } = useAction();
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => { const r = await searchCustomersAction(q); if (r.ok) setHits((r.data as Hit[]).filter((h) => h.id !== keepId)); }, 250);
    return () => clearTimeout(t);
  }, [q, keepId]);
  const hits = q.trim().length < 2 ? [] : found;
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Merge duplicate</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Merge a duplicate into this customer">
        <div className="space-y-4 text-sm">
          <p>Everything from the duplicate (properties, appointments, quotes, recurring schedules, payments, emails) moves to <strong>{keepName}</strong>. Missing email/phone is filled in and notes are combined. The duplicate is archived, not deleted.</p>
          {suggestions.length > 0 && (
            <div><p className="field-label">Likely duplicates</p>
              <ul className="space-y-1">{suggestions.map((s) => <li key={s.id}><button type="button" className={`w-full rounded-[var(--radius-control)] border px-3 py-2 text-left ${target?.id === s.id ? "border-gold bg-cream" : "border-line bg-white"}`} onClick={() => setTarget(s)}><span className="font-semibold">{s.full_name}</span> <span className="text-muted">· {s.reason}{s.email ? ` · ${s.email}` : ""}</span></button></li>)}</ul>
            </div>
          )}
          <label className="block"><span className="field-label">Or search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" /></label>
          {hits.length > 0 && <ul className="space-y-1">{hits.map((s) => <li key={s.id}><button type="button" className={`w-full rounded-[var(--radius-control)] border px-3 py-2 text-left ${target?.id === s.id ? "border-gold bg-cream" : "border-line bg-white"}`} onClick={() => setTarget(s)}><span className="font-semibold">{s.full_name}</span> <span className="text-muted">{s.email ?? ""}</span></button></li>)}</ul>}
          <div className="flex gap-3">
            <button type="button" className="btn btn-danger" disabled={!target || pending} onClick={() => target && run(() => mergeCustomersAction(keepId, target.id), { onSuccess: () => { setOpen(false); router.refresh(); } })}>{target ? `Merge ${target.full_name} into ${keepName}` : "Choose the duplicate"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function RecordPaymentButton({ customerId, appointments }: { customerId: string; appointments: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("zelle");
  const [appt, setAppt] = useState("");
  const [date, setDate] = useState(DateTime.now().toISODate()!);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const { run, pending } = useAction();
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>Record payment</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Record a payment">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const c = parseMoneyToCents(amount);
          if (!c || c <= 0) return setErr("Enter the amount received.");
          setErr("");
          run(() => recordPaymentAction({ customer_id: customerId, appointment_id: appt || null, amount_cents: c, method, received_on: date, notes }), { onSuccess: () => { setOpen(false); setAmount(""); setNotes(""); } });
        }}>
          <label><span className="field-label">Amount</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label><span className="field-label">Method</span><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{["cash", "card", "zelle", "venmo", "check", "other"].map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}</select></label>
          <label><span className="field-label">Received on</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label><span className="field-label">For visit</span><select className="input" value={appt} onChange={(e) => setAppt(e.target.value)}><option value="">Not linked</option>{appointments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="field-label">Notes</span><input className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {err && <p className="field-error sm:col-span-2" role="alert">{err}</p>}
          <p className="text-xs text-muted sm:col-span-2">This records money you already received. It does not charge the customer.</p>
          <div className="flex gap-3 sm:col-span-2"><button className="btn btn-primary" disabled={pending}>Save payment</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Dialog>
    </>
  );
}

export function DeletePaymentButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  return <ConfirmButton label="Remove" title="Remove this payment?" body="Use this only to fix a mistake." confirmLabel="Remove" danger className="btn btn-ghost btn-sm text-danger" disabled={pending} onConfirm={() => run(() => deletePaymentAction(id))} />;
}

export function ContactMessageActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={() => run(() => contactToCustomerAction(id), { onSuccess: (r) => router.push(`/admin/customers/${(r.data as { id: string }).id}`) })}>Open as customer</button>
      {status !== "handled" && <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => contactMessageStatusAction(id, "handled"))}>Mark handled</button>}
      {status !== "spam" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => contactMessageStatusAction(id, "spam"))}>Spam</button>}
      {status !== "new" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => contactMessageStatusAction(id, "new"))}>Mark new</button>}
    </div>
  );
}
