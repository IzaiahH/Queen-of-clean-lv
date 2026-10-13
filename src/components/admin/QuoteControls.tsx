"use client";

import { useState } from "react";
import { CalendarPlus, Send } from "lucide-react";
import { overrideQuoteAction, quoteStatusAction, sendQuoteAction } from "@/app/admin/actions/quotes";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";
import type { CleanerOption } from "./AppointmentPanel";
import { NewAppointmentDialog, type ServiceOption } from "./NewAppointmentDialog";

type Q = { id: string; reference: string; status: string; estimate_cents: number; override_cents: number | null; override_reason: string | null; service_slug: string; estimated_minutes: number; property_id: string | null; frequency: string; customer_email: string | null; has_appointment: boolean };
type Customer = { id: string; full_name: string; email: string | null; phone: string | null; properties: { id: string; label: string; address: string | null; has_address: boolean }[]; last_price: number | null; last_minutes: number | null } | null;

export function QuoteControls({ q, canOverride, customer, tz, services, cleaners }: { q: Q; canOverride: boolean; customer: Customer; tz: string; services: ServiceOption[]; cleaners: CleanerOption[] }) {
  const { run, pending } = useAction();
  const [ov, setOv] = useState(false);
  const [book, setBook] = useState(false);
  const [amount, setAmount] = useState(centsToInput(q.override_cents ?? q.estimate_cents));
  const [reason, setReason] = useState(q.override_reason ?? "");
  const [err, setErr] = useState("");
  const open = ["draft", "sent", "pending_customer"].includes(q.status);
  const amountNow = q.override_cents ?? q.estimate_cents;

  return (
    <div className="flex flex-wrap gap-2">
      {["draft", "sent", "pending_customer", "expired"].includes(q.status) && (
        <ConfirmButton className="btn btn-dark btn-sm" disabled={pending || !q.customer_email} label={<><Send className="size-4" aria-hidden />{q.status === "draft" ? "Send to customer" : "Resend link"}</>}
          title="Email this quote?" confirmLabel="Send email"
          body={<p>The customer gets an email with {formatCents(amountNow)} and a secure link to review and accept it. Any earlier link stops working. If the email fails, the quote stays in its current status.</p>}
          onConfirm={() => run(() => sendQuoteAction(q.id))} />
      )}
      {!q.customer_email && open && <span className="self-center text-xs text-status-pending">Add an email to the customer to send this quote.</span>}
      {customer && !q.has_appointment && ["draft", "sent", "pending_customer", "accepted"].includes(q.status) && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setBook(true)} disabled={!customer.properties.length}><CalendarPlus className="size-4" aria-hidden />Book this quote</button>
      )}
      {canOverride && open && <button type="button" className="btn btn-outline btn-sm" onClick={() => setOv(true)}>Adjust price</button>}
      {open && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => quoteStatusAction(q.id, "accepted"))}>Mark accepted</button>}
      {open && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => quoteStatusAction(q.id, "declined"))}>Mark declined</button>}
      {open && q.status !== "draft" && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => quoteStatusAction(q.id, "expired"))}>Expire</button>}
      {["declined", "expired"].includes(q.status) && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => quoteStatusAction(q.id, "draft"))}>Reopen as draft</button>}

      <Dialog open={ov} onClose={() => setOv(false)} title="Adjust quoted price">
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const c = parseMoneyToCents(amount);
          if (c === null) return setErr("Enter an amount.");
          if (!reason.trim()) return setErr("Give a reason. It's saved with your name and the time.");
          setErr("");
          run(() => overrideQuoteAction(q.id, c, reason), { onSuccess: () => setOv(false) });
        }}>
          <p className="text-sm text-muted">Calculated price: {formatCents(q.estimate_cents)}. The calculation is kept; your amount is what the customer sees and agrees to.</p>
          <label className="block"><span className="field-label">New amount</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="block"><span className="field-label">Reason</span><textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Walkthrough showed heavy buildup in kitchen" /></label>
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary" disabled={pending}>Save price</button>
            {q.override_cents !== null && <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(() => overrideQuoteAction(q.id, null, ""), { onSuccess: () => setOv(false) })}>Use calculated price</button>}
            <button type="button" className="btn btn-ghost" onClick={() => setOv(false)}>Cancel</button>
          </div>
        </form>
      </Dialog>
      {customer && (
        <NewAppointmentDialog open={book} onClose={() => setBook(false)} tz={tz} services={services} cleaners={cleaners} customer={customer}
          quote={{ id: q.id, reference: q.reference, service_slug: q.service_slug, price_cents: amountNow, minutes: q.estimated_minutes, property_id: q.property_id, frequency: q.frequency }} />
      )}
    </div>
  );
}
