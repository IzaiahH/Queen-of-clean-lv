import "server-only";
import { ZodError } from "zod";
import { AuthError, actorOf, requireCap, type StaffUser } from "@/lib/auth/session";
import type { Capability } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/server/audit";

export type Res = { ok: boolean; message?: string; error?: string; conflicts?: string[]; email?: { status: string; error?: string } | null; data?: unknown };

/** Every server action goes through this: verifies the session and capability server-side, and turns errors into messages. */
export async function guard(cap: Capability, fn: (user: StaffUser, actor: Actor) => Promise<Res>): Promise<Res> {
  try {
    const user = await requireCap(cap);
    return await fn(user, actorOf(user));
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ") };
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23P01") return { ok: false, error: "That would double-book a cleaner." };
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") return { ok: false, error: "That already exists (duplicate name, code or email)." };
    if (e instanceof Error && !("code" in e)) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
  }
}

export function plainEmail(r: { status: string; error?: string } | null | undefined) {
  return r ? { status: r.status, error: r.error } : null;
}
