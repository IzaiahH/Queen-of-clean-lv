import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authProvider } from "@/lib/auth/session";
import { ROLES } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { audit, type Actor } from "./audit";
import { hashPassword } from "./security";

/** Service-role client. Only ever constructed on the server, only for staff account administration. */
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so accounts can't be created here. Use `npm run admin:create`.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const staffInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  full_name: z.string().trim().min(1, "Enter a name").max(120),
  role: z.enum(ROLES),
  cleaner_id: z.string().uuid().nullable(),
  password: z.string().min(12, "Use a temporary password of at least 12 characters").max(200),
});

export async function listStaff() {
  const rows = await db()<{ id: string; email: string; full_name: string; role: string; active: boolean; cleaner_id: string | null; cleaner_name: string | null; last_sign_in_at: Date | null }[]>`
    select p.id, p.email, p.full_name, p.role, p.active, p.cleaner_id, c.full_name as cleaner_name, p.last_sign_in_at
      from profiles p left join cleaners c on c.id = p.cleaner_id order by p.active desc, p.role, p.full_name`;
  return Array.from(rows).map((r) => ({ ...r }));
}

export async function createStaffAccount(actor: Actor, input: z.input<typeof staffInputSchema>) {
  const d = staffInputSchema.parse(input);
  if (d.role === "cleaner" && !d.cleaner_id) return { ok: false as const, error: "Link a cleaner account to a cleaner profile." };
  const [exists] = await db()`select 1 from profiles where lower(email) = ${d.email}`;
  if (exists) return { ok: false as const, error: "There's already an account with that email." };
  let authUserId: string | null = null;
  let hash: string | null = null;
  if (authProvider() === "supabase") {
    const { data, error } = await supabaseAdmin().auth.admin.createUser({ email: d.email, password: d.password, email_confirm: true });
    if (error) return { ok: false as const, error: `Supabase: ${error.message}` };
    authUserId = data.user.id;
  } else {
    hash = await hashPassword(d.password);
  }
  const [row] = await db()<{ id: string }[]>`
    insert into profiles (email, full_name, role, cleaner_id, auth_user_id, password_hash, active)
    values (${d.email}, ${d.full_name}, ${d.role}, ${d.role === "cleaner" ? d.cleaner_id : null}, ${authUserId}, ${hash}, true) returning id`;
  await audit(actor, "user.create", "profile", row.id, { role: d.role, email: d.email });
  return { ok: true as const };
}

async function ownersLeft(excludingId: string) {
  const [{ n }] = await db()<{ n: number }[]>`select count(*)::int as n from profiles where role = 'owner' and active and id <> ${excludingId}`;
  return n;
}

export async function updateStaffAccount(actor: Actor, id: string, input: { role: (typeof ROLES)[number]; active: boolean; cleaner_id: string | null; full_name: string }) {
  const [cur] = await db()<{ role: string; active: boolean; auth_user_id: string | null }[]>`select role, active, auth_user_id from profiles where id = ${id}`;
  if (!cur) return { ok: false as const, error: "Account not found" };
  if (cur.role === "owner" && (input.role !== "owner" || !input.active) && (await ownersLeft(id)) === 0)
    return { ok: false as const, error: "There must always be at least one active owner." };
  if (input.role === "cleaner" && !input.cleaner_id) return { ok: false as const, error: "Link a cleaner account to a cleaner profile." };
  await db()`update profiles set role = ${input.role}, active = ${input.active}, cleaner_id = ${input.role === "cleaner" ? input.cleaner_id : null}, full_name = ${input.full_name} where id = ${id}`;
  if (!input.active || input.role !== cur.role) await db()`delete from sessions where profile_id = ${id}`;
  if (cur.auth_user_id && !input.active && authProvider() === "supabase") {
    await supabaseAdmin().auth.admin.updateUserById(cur.auth_user_id, { ban_duration: "876000h" }).catch(() => null);
  }
  if (cur.auth_user_id && input.active && !cur.active && authProvider() === "supabase") {
    await supabaseAdmin().auth.admin.updateUserById(cur.auth_user_id, { ban_duration: "none" }).catch(() => null);
  }
  await audit(actor, "user.update", "profile", id, { role: input.role, active: input.active });
  return { ok: true as const };
}

export async function resetStaffPassword(actor: Actor, id: string, password: string) {
  if (password.length < 12) return { ok: false as const, error: "Use at least 12 characters." };
  const [cur] = await db()<{ auth_user_id: string | null }[]>`select auth_user_id from profiles where id = ${id}`;
  if (!cur) return { ok: false as const, error: "Account not found" };
  if (authProvider() === "supabase") {
    if (!cur.auth_user_id) return { ok: false as const, error: "This account isn't linked to Supabase Auth." };
    const { error } = await supabaseAdmin().auth.admin.updateUserById(cur.auth_user_id, { password });
    if (error) return { ok: false as const, error: `Supabase: ${error.message}` };
  } else {
    await db()`update profiles set password_hash = ${await hashPassword(password)} where id = ${id}`;
  }
  await db()`delete from sessions where profile_id = ${id}`;
  await audit(actor, "user.password_reset", "profile", id);
  return { ok: true as const };
}
