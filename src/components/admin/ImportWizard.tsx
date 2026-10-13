"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { analyzeImportAction, commitImportAction, discardImportAction } from "@/app/admin/actions/imports";
import { useToast } from "@/components/ui/Toast";
import { formatCents, parseMoneyToCents, centsToInput } from "@/lib/money";
import { parseCsv } from "@/lib/import/csv";
import { IMPORT_FIELDS, type ImportField, type ReviewRow } from "@/lib/import/review";

type Analysis = { batch_id: string; mapping: ImportField[]; rows: ReviewRow[]; summary: Record<string, number> };
const MAX_ROWS = 2000;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
  return String(v);
}

export function ImportWizard() {
  const router = useRouter();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [a, setA] = useState<Analysis | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState<"" | "reading" | "checking" | "saving">("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "issues" | "import" | "skip">("all");
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  async function onFile(f: File) {
    setError(""); setA(null); setDone(null); setBusy("reading");
    try {
      let data: string[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(f);
        data = sheet.map((r) => r.map(cellText));
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        data = parseCsv(await f.text());
      } else throw new Error("Choose a .csv or .xlsx file. (Older .xls files: open in Excel or Google Sheets and save as .xlsx or .csv.)");
      // First non-empty row is the header row.
      const start = data.findIndex((r) => r.some((c) => c.trim()));
      if (start < 0) throw new Error("That file looks empty.");
      const headers = data[start].map((h, i) => h.trim() || `Column ${i + 1}`);
      const body = data.slice(start + 1).filter((r) => r.some((c) => c.trim()));
      if (body.length > MAX_ROWS) throw new Error(`That file has ${body.length} rows. Split it into files of ${MAX_ROWS} rows or fewer.`);
      setFile({ name: f.name, headers, rows: body.map((r) => headers.map((_, i) => (r[i] ?? "").slice(0, 5000))) });
      await analyze({ name: f.name, headers, rows: body }, null, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy("");
    }
  }

  async function analyze(src: { name: string; headers: string[]; rows: string[][] }, mapping: ImportField[] | null, batchId: string | null) {
    setBusy("checking");
    const r = await analyzeImportAction({ filename: src.name, headers: src.headers, rows: src.rows, mapping, batch_id: batchId });
    setBusy("");
    if (!r.ok) { setError(r.error ?? "Couldn't check the file."); return; }
    const data = r.data as Analysis;
    setA(data);
    setRows(data.rows);
  }

  const setRow = (i: number, fn: (r: ReviewRow) => ReviewRow) => setRows(rows.map((r, j) => (j === i ? fn(r) : r)));
  const counts = { import: rows.filter((r) => r.decision === "import").length, skip: rows.filter((r) => r.decision === "skip").length };
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter === "all" || (filter === "issues" ? r.issues.length > 0 || r.duplicates.length > 0 : r.decision === filter));

  async function commit() {
    if (!a) return;
    setBusy("saving");
    const r = await commitImportAction(a.batch_id, rows.map((x) => ({ index: x.index, decision: x.decision, parsed: x.parsed })));
    setBusy("");
    if (!r.ok) { setError(r.error ?? "Import failed. Nothing was saved."); return; }
    setDone(r.data as { created: number; skipped: number });
    toast({ kind: "success", text: r.message ?? "Imported." });
    router.refresh();
  }

  if (done) return (
    <div className="card space-y-3 p-6">
      <p className="flex items-center gap-2 text-xl font-semibold"><CheckCircle2 className="size-6 text-status-completed" aria-hidden />Imported {done.created} customer{done.created === 1 ? "" : "s"}</p>
      <p className="text-sm text-muted">{done.skipped} row{done.skipped === 1 ? "" : "s"} skipped. Imported records are marked &quot;Imported&quot; with the spreadsheet values in their private notes. Nothing was scheduled automatically: book each customer&apos;s next cleaning from their profile.</p>
      <div className="flex gap-2"><Link href="/admin/customers?sort=recent" className="btn btn-dark btn-sm">View customers</Link><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDone(null); setA(null); setFile(null); }}>Import another file</button></div>
    </div>
  );

  return (
    <div className="space-y-5">
      {!a && (
        <label className="card flex cursor-pointer flex-col items-center gap-3 border-dashed p-8 text-center hover:border-gold">
          {busy ? <Loader2 className="size-8 animate-spin text-gold" aria-hidden /> : <Upload className="size-8 text-gold" aria-hidden />}
          <span className="text-lg font-semibold">{busy === "reading" ? "Reading file…" : busy === "checking" ? "Checking rows…" : "Choose a spreadsheet"}</span>
          <span className="text-sm text-muted">.csv or .xlsx, up to {MAX_ROWS.toLocaleString()} rows. The first row should be column names. Nothing is saved until you confirm.</span>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={Boolean(busy)} />
        </label>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}

      {a && file && (
        <>
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-2xl font-semibold"><FileSpreadsheet className="size-5 text-gold" aria-hidden />1. Match columns</h2>
              <span className="text-sm text-muted">{file.name} · {file.rows.length} rows</span>
            </div>
            <p className="text-sm text-muted">Tell us what each column holds. Profit or monthly totals are recalculated by the app, so they&apos;re ignored. Anything unclear can be kept as a note.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {file.headers.map((h, i) => (
                <label key={i} className="block rounded-[var(--radius-control)] border border-line bg-white p-3">
                  <span className="block truncate text-sm font-semibold">{h}</span>
                  <span className="block truncate text-xs text-muted">e.g. {file.rows.find((r) => r[i]?.trim())?.[i] ?? "(empty)"}</span>
                  <select className="input mt-2 !min-h-10" value={a.mapping[i]} onChange={(e) => setA({ ...a, mapping: a.mapping.map((m, j) => (j === i ? (e.target.value as ImportField) : m)) })}>
                    {Object.entries(IMPORT_FIELDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-outline btn-sm mt-3" disabled={Boolean(busy)} onClick={() => analyze(file, a.mapping, a.batch_id)}>{busy === "checking" ? "Checking…" : "Re-check with these columns"}</button>
          </section>

          <section className="card p-5">
            <h2 className="text-2xl font-semibold">2. Review rows</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-status-completed-bg px-3 py-1 font-semibold text-status-completed">{counts.import} to import</span>
              <span className="rounded-full bg-status-cancelled-bg px-3 py-1 font-semibold text-status-cancelled">{counts.skip} skipped</span>
              {a.summary.possible_duplicates > 0 && <span className="rounded-full bg-status-pending-bg px-3 py-1 font-semibold text-status-pending">{a.summary.possible_duplicates} possible duplicates</span>}
              {a.summary.with_errors > 0 && <span className="rounded-full bg-status-declined-bg px-3 py-1 font-semibold text-status-declined">{a.summary.with_errors} with errors</span>}
            </div>
            <p className="mt-2 text-xs text-muted">Rows with errors or possible duplicates start as &quot;skip&quot;. Fix a value or switch a row to import if you&apos;re sure. Values that couldn&apos;t be read are kept as notes, never guessed.</p>
            <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Show">
              {(["all", "issues", "import", "skip"] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${filter === f ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white"}`}>{f === "all" ? "All" : f === "issues" ? "Needs a look" : f === "import" ? "Importing" : "Skipping"}</button>)}
            </div>
            <ul className="mt-3 space-y-3">
              {shown.slice(0, 300).map(({ r, i }) => (
                <li key={r.index} className={`rounded-[var(--radius-control)] border p-3 ${r.decision === "import" ? "border-line bg-white" : "border-dashed border-line bg-cream/40"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted">Row {r.index}</span>
                    <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={r.decision === "import"} onChange={(e) => setRow(i, (x) => ({ ...x, decision: e.target.checked ? "import" : "skip" }))} />Import this row</label>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <label><span className="field-label text-xs">Name</span><input className="input !min-h-9 !py-1" value={r.parsed.full_name} onChange={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, full_name: e.target.value } }))} /></label>
                    <label><span className="field-label text-xs">Email</span><input className="input !min-h-9 !py-1" value={r.parsed.email ?? ""} onChange={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, email: e.target.value || null } }))} /></label>
                    <label><span className="field-label text-xs">Phone</span><input className="input !min-h-9 !py-1" value={r.parsed.phone ?? ""} onChange={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, phone: e.target.value || null } }))} /></label>
                    <label><span className="field-label text-xs">Price per visit</span><input className="input !min-h-9 !py-1" inputMode="decimal" defaultValue={r.parsed.agreed_price_cents !== null ? centsToInput(r.parsed.agreed_price_cents) : ""} onBlur={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, agreed_price_cents: e.target.value ? parseMoneyToCents(e.target.value) : null } }))} /></label>
                    <label className="sm:col-span-2"><span className="field-label text-xs">Street address</span><input className="input !min-h-9 !py-1" value={r.parsed.address_line1 ?? ""} onChange={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, address_line1: e.target.value || null } }))} /></label>
                    <label><span className="field-label text-xs">ZIP</span><input className="input !min-h-9 !py-1" maxLength={5} value={r.parsed.zip ?? ""} onChange={(e) => setRow(i, (x) => ({ ...x, parsed: { ...x.parsed, zip: e.target.value.replace(/\D/g, "") || null } }))} /></label>
                    <p className="self-end pb-1 text-xs text-muted">{[r.parsed.area_name, r.parsed.bedrooms !== null && `${r.parsed.bedrooms} bd`, r.parsed.full_baths !== null && `${r.parsed.full_baths}${r.parsed.half_baths ? ".5" : ""} ba`, r.parsed.sqft && `${r.parsed.sqft} sq ft`, r.parsed.frequency, r.parsed.agreed_price_cents !== null && formatCents(r.parsed.agreed_price_cents)].filter(Boolean).join(" · ")}</p>
                  </div>
                  {(r.issues.length > 0 || r.duplicates.length > 0) && (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {r.issues.map((x, k) => <li key={k} className={x.level === "error" ? "text-danger" : "text-status-pending"}><AlertTriangle className="mr-1 inline size-3" aria-hidden />{x.field}: {x.message}</li>)}
                      {r.duplicates.map((d) => <li key={d.id} className="text-status-pending">Matches {d.name} ({d.reason})</li>)}
                    </ul>
                  )}
                  {r.parsed.notes.length > 0 && <p className="mt-2 text-xs text-muted">Notes kept: {r.parsed.notes.join(" | ")}</p>}
                </li>
              ))}
            </ul>
            {shown.length > 300 && <p className="mt-2 text-xs text-muted">Showing the first 300 rows in this view. All rows are included when you confirm.</p>}
          </section>

          <div className="card flex flex-wrap items-center gap-3 p-5">
            <button type="button" className="btn btn-primary" disabled={Boolean(busy) || counts.import === 0} onClick={commit}>{busy === "saving" ? "Importing…" : `Import ${counts.import} customer${counts.import === 1 ? "" : "s"}`}</button>
            <button type="button" className="btn btn-ghost" disabled={Boolean(busy)} onClick={async () => { await discardImportAction(a.batch_id); setA(null); setFile(null); }}>Discard</button>
            <p className="text-xs text-muted">Creates customer and home records only. No emails are sent and no appointments are created.</p>
          </div>
        </>
      )}
    </div>
  );
}
