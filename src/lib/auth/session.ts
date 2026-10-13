import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { db } from "@/lib/db";
import { newToken, sha256 } from "@/lib/server/security";
import { can, type Capability, type Role } from "./permissions";
import type { Actor } from "@/lib/server/audit";

export const SESSION_COOKIE = "qoc_session";
const SESSION_DAYS = 14;

export type StaffUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  cleaner_id: string | null;
};

export function authProvider(): "supabase" | "local" {
  const explicit = process.env.AUTH_PROVIDER;
  if (explicit === "supabase" || explicit === "local") return explicit;
  return process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local";
}

export function supabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function supabaseServer() {
  const store = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabasePublicKey();
  if (!url || !key) throw new Error("Supabase auth is selected but NEXT_PUBLIC_SUPABASE_URL / publishable key are missing.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}

async function loadProfile(where: { id?: string; authUserId?: string }): Promise<StaffUser | null> {
  const sql = db();
  const rows = where.id
    ? await sql<StaffUser[]>`select id, email, full_name, role, cleaner_id from profiles where id = ${where.id} and active`
    : await sql<StaffUser[]>`select id, email, full_name, role, cleaner_id from profiles where auth_user_id = ${where.authUserId!} and active`;
  return rows[0] ?? null;
}

/** The signed-in staff member for this request, verified server-side, or null. */
export const getCurrentUser = cache(async (): Promise<StaffUser | null> => {
  if (authProvider() === "supabase") {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return loadProfile({ authUserId: data.user.id });
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()<{ profile_id: string }[]>`
    select s.profile_id from sessions s where s.id = ${sha256(token)} and s.expires_at > now()`;
  if (!row) return null;
  return loadProfile({ id: row.profile_id });
});

export async function createLocalSession(profileId: string, userAgent: string | null) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db()`insert into sessions (id, profile_id, expires_at, user_agent) values (${sha256(token)}, ${profileId}, ${expires}, ${userAgent})`;
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  if (authProvider() === "supabase") {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
    return;
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db()`delete from sessions where id = ${sha256(token)}`;
  store.delete(SESSION_COOKIE);
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/** For server components/pages: redirect to sign-in, or show the forbidden page. */
export async function requirePage(cap: Capability): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  if (!can(user.role, cap)) {
    if (user.role === "cleaner") redirect("/admin/my-jobs");
    redirect("/admin/forbidden");
  }
  return user;
}

/** For server actions and route handlers: throws AuthError, never redirects. */
export async function requireCap(cap: Capability): Promise<StaffUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "Please sign in again.");
  if (!can(user.role, cap)) throw new AuthError(403, "You don't have permission to do that.");
  return user;
}

export function actorOf(user: StaffUser): Actor {
  return { id: user.id, label: user.full_name };
}
