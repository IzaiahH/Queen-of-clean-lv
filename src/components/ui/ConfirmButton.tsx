"use client";

import { useState } from "react";
import { Dialog } from "./Dialog";

/** Button that asks for confirmation before a destructive or customer-visible action. */
export function ConfirmButton({ label, title, body, confirmLabel, onConfirm, className = "btn btn-outline btn-sm", danger = false, disabled = false, withReason = false, reasonLabel = "Reason" }: {
  label: React.ReactNode; title: string; body: React.ReactNode; confirmLabel: string; onConfirm: (reason: string) => void; className?: string; danger?: boolean; disabled?: boolean; withReason?: boolean; reasonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <button type="button" className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <div className="text-sm">{body}</div>
        {withReason && (
          <div className="mt-4">
            <label className="field-label" htmlFor="confirm-reason">{reasonLabel}</label>
            <textarea id="confirm-reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className={`btn ${danger ? "btn-danger" : "btn-dark"}`} onClick={() => { setOpen(false); onConfirm(reason); setReason(""); }}>{confirmLabel}</button>
        </div>
      </Dialog>
    </>
  );
}
