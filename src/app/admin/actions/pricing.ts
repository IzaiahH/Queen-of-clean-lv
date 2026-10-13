"use server";

import { z } from "zod";
import {
  discardDraft, publishDraft, saveAddon, saveArea, saveDraft, saveService, startDraft, testRules,
  type addonEditSchema, type areaEditSchema, type serviceEditSchema,
} from "@/lib/server/pricing-admin";
import { guard } from "./guard";

const uuidOrNull = z.string().uuid().nullable();

export async function startDraftAction() {
  return guard("pricing.edit", async (_u, actor) => ({ ok: true, message: "Draft created from the live prices.", data: { id: await startDraft(actor) } }));
}
export async function saveDraftAction(rules: unknown, notes: string) {
  return guard("pricing.edit", async (_u, actor) => {
    const r = await saveDraft(actor, rules, z.string().max(1000).parse(notes));
    if (!r.ok) return r;
    return { ok: true, message: r.warnings.length ? `Draft saved with ${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}.` : "Draft saved. Customers still see the live prices until you publish.", data: { warnings: r.warnings } };
  });
}
export async function publishDraftAction(notes: string) {
  return guard("pricing.edit", async (_u, actor) => {
    const r = await publishDraft(actor, z.string().max(1000).parse(notes));
    return r.ok ? { ok: true, message: `Version ${r.version} is live. New quotes use it; existing quotes keep their prices.` } : r;
  });
}
export async function discardDraftAction() {
  return guard("pricing.edit", async (_u, actor) => { await discardDraft(actor); return { ok: true, message: "Draft discarded." }; });
}
export async function testRulesAction(rules: unknown, input: unknown) {
  return guard("pricing.edit", async () => {
    const r = await testRules(rules, input);
    return r.ok ? { ok: true, data: r } : r;
  });
}
export async function saveServiceAction(id: string | null, input: z.input<typeof serviceEditSchema> & { slug?: string; kind?: string }) {
  return guard("pricing.edit", async (_u, actor) => { await saveService(actor, uuidOrNull.parse(id), input); return { ok: true, message: "Service saved." }; });
}
export async function saveAddonAction(id: string | null, input: z.input<typeof addonEditSchema> & { slug?: string }) {
  return guard("pricing.edit", async (_u, actor) => { await saveAddon(actor, uuidOrNull.parse(id), input); return { ok: true, message: "Add-on saved. Set its price in the pricing draft if it's new." }; });
}
export async function saveAreaAction(id: string | null, input: z.input<typeof areaEditSchema>) {
  return guard("pricing.edit", async (_u, actor) => { await saveArea(actor, uuidOrNull.parse(id), input); return { ok: true, message: "Service area saved." }; });
}
