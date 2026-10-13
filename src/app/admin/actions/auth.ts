"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { authProvider, createLocalSession, destroySession, supabaseServer } from "@/lib/auth/session";
import { audit } from "@/lib/server/audit";
import { clientIpHash, rateLimit, verifyPassword } from "@/lib/server/security";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const { email, password } = parsed.data;
  const ip = await clientIpHash();
  if (!(await rateLimit(`login:${ip}`, 10, 900)) || !(await rateLimit(`login:${email}`, 5, 900)))
    return { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };

  if (authProvider() === "supabase") {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error: "That email and password don't match." };
    const [p] = await db()<{ id: string; full_name: string }[]>`select id, full_name from profiles where auth_user_id = ${data.user.id} and active`;
    if (!p) {
      await supabase.auth.signOut();
      return { error: "This account doesn't have access to the admin area." };
    }
    await db()`update profiles set last_sign_in_at = now() where id = ${p.id}`;
    await audit({ id: p.id, label: p.full_name }, "auth.login", "profile", p.id);
  } else {
    const [p] = await db()<{ id: string; full_name: string; password_hash: string | null }[]>`
      select id, full_name, password_hash from profiles where lower(email) = ${email} and active`;
    // Always run the hash comparison so timing doesn't reveal which emails exist.
    const ok = await verifyPassword(password, p?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
    if (!p || !ok) return { error: "That email and password don't match." };
    await createLocalSession(p.id, (await headers()).get("user-agent"));
    await db()`update profiles set last_sign_in_at = now() where id = ${p.id}`;
    await audit({ id: p.id, label: p.full_name }, "auth.login", "profile", p.id);
  }
  // Limits are for failed attempts: a successful sign-in clears this person's counters.
  await db()`delete from rate_limits where bucket in (${`login:${ip}`}, ${`login:${email}`})`;
  redirect("/admin");
}

export async function logoutAction() {
  await destroySession();
  redirect("/admin/login");
}
