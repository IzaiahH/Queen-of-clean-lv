"use client";

import { useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { clockAction, reportDoneAction } from "@/app/admin/actions/my-jobs";
import { useAction } from "@/components/ui/useAction";

export type MyJob = {
  id: string; when: string; minutes: string; status: string; customer: string; phone: string | null; address: string; map_url: string;
  service: string; access: string; notes: string; customer_notes: string; addons: string[]; checklist: string[]; clocked_in: boolean; clocked_out: boolean; reported: boolean;
};

export function MyJobCard({ job, today }: { job: MyJob; today: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [note, setNote] = useState("");
  return (
    <article className={`card p-5 ${today ? "border-gold" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-lg font-semibold">{job.when}</p><p className="text-sm text-muted">{job.service} · {job.minutes}</p></div>
        {job.reported && <span className="rounded-full bg-status-completed-bg px-2.5 py-0.5 text-xs font-bold text-status-completed">Reported done</span>}
      </div>
      <p className="mt-3 font-semibold">{job.customer}</p>
      <a href={job.map_url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-start gap-1 text-sm hover:text-gold-ink"><MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />{job.address}</a>
      {job.phone && <a href={`tel:${job.phone}`} className="mt-1 flex items-center gap-1 text-sm hover:text-gold-ink"><Phone className="size-4 text-gold" aria-hidden />{job.phone}</a>}
      {job.access && <p className="mt-3 rounded-[var(--radius-control)] bg-cream p-3 text-sm"><span className="font-semibold">Access:</span> {job.access}</p>}
      {(job.customer_notes || job.notes) && <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-semibold">Notes:</span> {[job.customer_notes, job.notes].filter(Boolean).join("\n")}</p>}
      {job.addons.length > 0 && <p className="mt-2 text-sm"><span className="font-semibold">Extras:</span> {job.addons.join(", ")}</p>}
      {today && !job.reported && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!job.clocked_in && <button type="button" className="btn btn-dark btn-sm" disabled={pending} onClick={() => run(() => clockAction(job.id, "clock_in"))}>Clock in</button>}
          {job.clocked_in && !job.clocked_out && <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => run(() => clockAction(job.id, "clock_out"))}>Clock out</button>}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>Checklist & finish</button>
        </div>
      )}
      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <ul className="space-y-1">{job.checklist.map((c) => (
            <li key={c}><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={done.includes(c)} onChange={(e) => setDone(e.target.checked ? [...done, c] : done.filter((x) => x !== c))} />{c}</label></li>
          ))}</ul>
          <label className="block"><span className="field-label">Note for the office</span><textarea className="input" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => reportDoneAction(job.id, done, note), { onSuccess: () => setOpen(false) })}>Report job done</button>
        </div>
      )}
    </article>
  );
}
