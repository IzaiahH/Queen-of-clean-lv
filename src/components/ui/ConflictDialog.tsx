"use client";

import { AlertTriangle } from "lucide-react";
import { Dialog } from "./Dialog";

export function ConflictDialog({ conflicts, onCancel, kind = "schedule" }: { conflicts: { list: string[]; retry: () => void } | null; onCancel: () => void; kind?: "schedule" | "duplicate" }) {
  const dup = kind === "duplicate";
  return (
    <Dialog open={Boolean(conflicts)} onClose={onCancel} title={dup ? "Possible duplicate" : "Scheduling conflicts"}>
      <div className="flex gap-3">
        <AlertTriangle className="size-6 shrink-0 text-status-pending" aria-hidden />
        <div>
          <p className="text-sm">{dup ? "These existing customers look similar:" : "Saving this would cause:"}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">
            {conflicts?.list.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <p className="mt-3 text-sm text-muted">{dup ? "If this is the same person, go back and open their existing profile instead. Otherwise you can add a separate record." : <>You can save anyway (the conflict will be noted in the history), or go back and choose a different time or cleaner. Booking a cleaner into two overlapping jobs is never allowed.</>}</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Go back</button>
        <button type="button" className="btn btn-dark" onClick={() => conflicts?.retry()}>{dup ? "Add as new customer" : "Save anyway"}</button>
      </div>
    </Dialog>
  );
}
