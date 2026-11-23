"use client";

import { useState } from "react";
import { existingCustomersImportAction } from "@/app/admin/actions/imports";
import { useAction } from "@/components/ui/useAction";
import type { ImportReport } from "@/lib/import/existing-customers";

const OUTCOME: Record<string, string> = { created: "Created", unchanged: "Already imported", conflict: "Conflict — not changed", skipped: "Skipped", error: "Error" };

/** Upload the existing-customers file → preview (nothing saved) → apply. Re-running is always safe. */
export function ExistingCustomersImport() {
  const { run, pending } = useAction();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [plain, setPlain] = useState("");

  async function choose(f: File | undefined) {
    setReport(null);
    if (!f) return;
    setFileName(f.name);
    setText(await f.text());
  }
  function go(apply: boolean) {
    run(() => existingCustomersImportAction(text, apply), {
      onSuccess: (r) => {
        const d = r.data as { report: ImportReport; text: string };
        setReport(d.report);
        setPlain(d.text);
      },
    });
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([plain], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-report-${report?.mode}-${(report?.ran_at ?? "").slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card space-y-4 p-5">
      <div>
        <h2 className="text-2xl font-semibold">Existing customers with historical rates</h2>
        <p className="mt-1 text-sm text-muted">
          For your customer records file (JSON). Each customer keeps their exact historical rate, separate from website pricing, and is marked
          &ldquo;Existing client — verify current status&rdquo;. No visits are scheduled and nobody is charged. Running it again never creates duplicates
          or overwrites changes made since.
        </p>
      </div>
      <label className="btn btn-outline btn-sm w-full cursor-pointer sm:w-auto">
        {fileName ? `File: ${fileName}` : "Choose file"}
        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-dark btn-sm" disabled={!text || pending} onClick={() => go(false)}>Preview import</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!report || report.mode !== "dry_run" || pending} onClick={() => go(true)}>Apply import</button>
      </div>
      {report && (
        <div className="space-y-3 text-sm" aria-live="polite">
          <p className="font-semibold">
            {report.mode === "apply" ? "Applied" : "Preview (nothing saved)"} · {report.totals.created} to create · {report.totals.unchanged} unchanged · {report.totals.conflict} conflicts · {report.totals.skipped} skipped · {report.totals.error} errors
          </p>
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
            {report.records.map((r) => (
              <li key={`${r.ref}-${r.name}`} className="p-3">
                <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{r.name} <span className="font-normal text-muted">({r.ref})</span></span><span className={r.outcome === "error" || r.outcome === "conflict" ? "text-status-pending" : "text-gold-ink"}>{OUTCOME[r.outcome]}</span></p>
                <ul className="mt-1 list-disc pl-5 text-muted">{r.details.map((d) => <li key={d}>{d}</li>)}</ul>
              </li>
            ))}
          </ul>
          {report.warnings.length > 0 && (
            <div className="rounded-[var(--radius-control)] border border-status-pending/40 bg-status-pending-bg p-3">
              <p className="font-semibold text-status-pending">Please check</p>
              <ul className="mt-1 list-disc pl-5">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={download}>Download report</button>
        </div>
      )}
    </div>
  );
}
