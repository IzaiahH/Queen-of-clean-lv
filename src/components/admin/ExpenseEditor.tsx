"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import { deleteExpenseAction, saveExpenseAction } from "@/app/admin/actions/finance";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";
import { centsToInput, formatCents, parseMoneyToCents } from "@/lib/money";

export const EXPENSE_CATEGORIES: Record<string, string> = {
  supplies: "Supplies", mileage: "Mileage / gas", software: "Software", equipment: "Equipment", marketing: "Marketing", insurance: "Insurance", labor_other: "Other labor", other: "Other",
};
type Expense = { id: string; spent_on: string; category: string; amount_cents: number; description: string; is_estimate: boolean; appointment_ref: string | null };

function ExpenseDialog({ e, onClose }: { e: Expense | null; onClose: () => void }) {
  const [v, setV] = useState({ spent_on: e?.spent_on ?? DateTime.now().toISODate()!, category: e?.category ?? "supplies", amount: e ? centsToInput(e.amount_cents) : "", description: e?.description ?? "", is_estimate: e?.is_estimate ?? false });
  const [err, setErr] = useState("");
  const { run, pending } = useAction();
  return (
    <Dialog open onClose={onClose} title={e ? "Edit expense" : "Add expense"}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => {
        ev.preventDefault();
        const c = parseMoneyToCents(v.amount);
        if (!c) return setErr("Enter an amount.");
        run(() => saveExpenseAction(e?.id ?? null, { spent_on: v.spent_on, category: v.category as "supplies", amount_cents: c, description: v.description, is_estimate: v.is_estimate }), { onSuccess: onClose });
      }}>
        <label><span className="field-label">Date</span><input type="date" className="input" value={v.spent_on} onChange={(x) => setV({ ...v, spent_on: x.target.value })} /></label>
        <label><span className="field-label">Amount</span><input className="input" inputMode="decimal" value={v.amount} onChange={(x) => setV({ ...v, amount: x.target.value })} placeholder="0.00" /></label>
        <label><span className="field-label">Category</span><select className="input" value={v.category} onChange={(x) => setV({ ...v, category: x.target.value })}>{Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={v.is_estimate} onChange={(x) => setV({ ...v, is_estimate: x.target.checked })} />Estimate (not paid yet)</label>
        <label className="sm:col-span-2"><span className="field-label">Description</span><input className="input" maxLength={500} value={v.description} onChange={(x) => setV({ ...v, description: x.target.value })} /></label>
        {err && <p className="field-error sm:col-span-2" role="alert">{err}</p>}
        <p className="text-xs text-muted sm:col-span-2">Estimated expenses are shown separately and never subtracted from profit.</p>
        <div className="flex gap-3 sm:col-span-2"><button className="btn btn-primary" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

export function ExpenseList({ items }: { items: Expense[] }) {
  const [edit, setEdit] = useState<Expense | "new" | null>(null);
  const { run, pending } = useAction();
  return (
    <div className="space-y-3">
      <div className="flex justify-between gap-2"><h2 className="text-2xl font-semibold">Expenses</h2><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit("new")}>Add expense</button></div>
      {items.length === 0 ? <p className="text-sm text-muted">No expenses recorded in this period.</p> : (
        <ul className="divide-y divide-line">{items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0"><span className="font-semibold">{formatCents(x.amount_cents)}</span> · {EXPENSE_CATEGORIES[x.category] ?? x.category}{x.is_estimate && <span className="ml-1 rounded border border-dashed border-line px-1 text-xs">estimate</span>}
              <span className="block text-xs text-muted">{x.spent_on}{x.description ? ` · ${x.description}` : ""}{x.appointment_ref ? ` · job ${x.appointment_ref}` : ""}</span></span>
            <span className="flex gap-1"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(x)}>Edit</button>
              <ConfirmButton label="Delete" title="Delete this expense?" body="This can't be undone." confirmLabel="Delete" danger className="btn btn-ghost btn-sm text-danger" disabled={pending} onConfirm={() => run(() => deleteExpenseAction(x.id))} /></span>
          </li>
        ))}</ul>
      )}
      {edit && <ExpenseDialog e={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
