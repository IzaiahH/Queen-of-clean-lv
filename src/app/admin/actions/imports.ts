"use server";

import { z } from "zod";
import { analyzeImport, commitImport, discardImport, type analyzeSchema } from "@/lib/server/importer";
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
