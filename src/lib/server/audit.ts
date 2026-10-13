import "server-only";
import { db, type Tx } from "@/lib/db";

export type Actor = { id: string | null; label: string };
export const SYSTEM_ACTOR: Actor = { id: null, label: "System" };
export const CUSTOMER_ACTOR = (name: string): Actor => ({ id: null, label: `Customer (${name})` });

export async function audit(actor: Actor, action: string, entityType: string, entityId: string | null, details: Record<string, unknown> = {}, tx: Tx = db()) {
  await tx`
    insert into audit_logs (actor_profile_id, actor_label, action, entity_type, entity_id, details)
    values (${actor.id}, ${actor.label}, ${action}, ${entityType}, ${entityId}, ${tx.json(details as never)})`;
}
