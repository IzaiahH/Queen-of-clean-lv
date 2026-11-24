"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { authProvider, supabaseServer } from "@/lib/auth/session";
import { issueRecoveryTicket, RECOVERY_COOKIE, verifyRecoveryTicket } from "@/lib/auth/recovery";
import { audit } from "@/lib/server/audit";
import { appUrl } from "@/lib/server/email";
import { clientIpHash, rateLimit } from "@/lib/server/security";

export type FormState = { error?: string; sent?: boolean } | undefined;

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() });

/**
 * Step 1: "Forgot password?" Always answers the same way, whether or not the email has an
 * account, so the form can't be used to find out who works here.
 */
export async function requestPasswordResetAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (authProvider() !== "supabase") return { error: "Password reset by email isn't available here. Ask an owner to reset your password." };
  const parsed = emailSchema.safeParse({ email: form.get("email") });
  if (!parsed.success) return { error: "Enter the email address you sign in with." };
  const { email } = parsed.data;
  const ip = await clientIpHash();
  if (!(await rateLimit(`pwreset:${ip}`, 5, 3600)) || !(await rateLimit(`pwreset:${email}`, 3, 3600)))
    return { error: "Too many reset requests. Please wait an hour and try again." };

  const [p] = await db()<{ id: string }[]>`select id from profiles where lower(email) = ${email} and active and auth_user_id is not null`;
  if (p) {
    const supabase = await supabaseServer();
    // The email template sends people to /admin/auth/confirm (see OWNER-GUIDE.md → Password reset).
    // redirectTo is only used if that template hasn't been set up yet.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl("/admin/auth/confirm") });
    if (error) console.error("Password reset email failed", error.message);
    else await audit({ id: p.id, label: email }, "auth.password_reset_requested", "profile", p.id);
  }
  return { sent: true };
}

const tokenSchema = z.object({ token_hash: z.string().min(10).max(500) });

/**
 * Step 2: runs only when the person taps "Continue". Email scanners that open the link
 * automatically never reach this, so they can't use up the one-time link.
 */
export async function confirmRecoveryAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (authProvider() !== "supabase") return { error: "Password reset by email isn't available here." };
  const parsed = tokenSchema.safeParse({ token_hash: form.get("token_hash") });
  if (!parsed.success) return { error: "This reset link is incomplete. Request a new one." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: parsed.data.token_hash });
  if (error || !data.user) return { error: "This reset link has expired or was already used. Request a new one." };

  const [p] = await db()<{ id: string }[]>`select id from profiles where auth_user_id = ${data.user.id} and active`;
  if (!p) {
    await supabase.auth.signOut();
    return { error: "This account doesn't have access to the admin area." };
  }
  const ticket = issueRecoveryTicket(data.user.id);
  (await cookies()).set(RECOVERY_COOKIE, ticket.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    expires: ticket.expires,
  });
  redirect("/admin/reset-password");
}

const passwordSchema = z
  .object({ password: z.string().min(12, "Use at least 12 characters.").max(200), confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: "The two passwords don't match.", path: ["confirm"] });

/** Step 3: save the new password, then sign out everywhere so the person signs in fresh. */
export async function setNewPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (authProvider() !== "supabase") return { error: "Password reset by email isn't available here." };
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your new password." };

  const store = await cookies();
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !verifyRecoveryTicket(store.get(RECOVERY_COOKIE)?.value, data.user.id))
    return { error: "Your reset link has expired. Request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message.includes("different from the old") ? "Choose a password you haven't used before." : "We couldn't save that password. Try a different one." };

  const [p] = await db()<{ id: string; full_name: string }[]>`select id, full_name from profiles where auth_user_id = ${data.user.id}`;
  if (p) {
    await db()`delete from sessions where profile_id = ${p.id}`;
    await audit({ id: p.id, label: p.full_name }, "auth.password_reset_completed", "profile", p.id);
  }
  store.delete({ name: RECOVERY_COOKIE, path: "/admin" });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/admin/login?reset=done");
}
