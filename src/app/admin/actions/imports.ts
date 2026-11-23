"use server";

import { z } from "zod";
import { analyzeImport, commitImport, discardImport, type analyzeSchema } from "@/lib/server/importer";
import { db } from "@/lib/db";
import { formatReport, importExistingCustomers } from "@/lib/import/existing-customers";
import { guard } from "./guard";

export async function analyzeImportAction(input: z.input<typeof analyzeSchema>) {
  return guard("data.import", async (_u, actor) => ({ ok: true, data: await analyzeImport(actor, input) }));
}
export async function commitImportAction(batchId: string, rows: unknown[]) {
  return guard("data.import", async (_u, actor) => {
    const r = await commitImport(actor, z.string().uuid().parse(batchId), rows);
    return r.ok ? { ok: true, message: `Imported ${r.created} customer${r.created === 1 ? "" : "s"}. ${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped.`, data: r } : r;
  });
}
export async function discardImportAction(batchId: string) {
  return guard("data.import", async (_u, actor) => { await discardImport(actor, z.string().uuid().parse(batchId)); return { ok: true, message: "Import discarded. Nothing was saved." }; });
}

const MAX_FILE_CHARS = 200_000;

/** Existing-customer import (with historical rates). Preview runs everything and rolls it back. */
export async function existingCustomersImportAction(fileText: string, apply: boolean) {
  return guard("data.import", async (_u, actor) => {
    const text = z.string().max(MAX_FILE_CHARS, "That file is too large for this import.").parse(fileText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "That file isn't valid JSON. Use the existing-customers template." };
    }
    const report = await importExistingCustomers(db(), parsed, { apply: z.boolean().parse(apply), actor });
    const t = report.totals;
    return {
      ok: true,
      message: apply
        ? `Import finished: ${t.created} created, ${t.unchanged} unchanged, ${t.conflict} conflict${t.conflict === 1 ? "" : "s"}, ${t.error} error${t.error === 1 ? "" : "s"}.`
        : "Preview ready. Nothing has been saved yet.",
      data: { report, text: formatReport(report) },
    };
  });
}
