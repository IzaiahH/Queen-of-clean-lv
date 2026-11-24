import Link from "next/link";
import { cookies } from "next/headers";
import { AuthCard } from "@/components/admin/AuthCard";
import { authProvider, supabaseServer } from "@/lib/auth/session";
import { RECOVERY_COOKIE, verifyRecoveryTicket } from "@/lib/auth/recovery";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage() {
  let allowed = false;
  if (authProvider() === "supabase") {
    const { data } = await (await supabaseServer()).auth.getUser();
    allowed = Boolean(data.user && verifyRecoveryTicket((await cookies()).get(RECOVERY_COOKIE)?.value, data.user.id));
  }
  if (!allowed)
    return (
      <AuthCard title="Link expired" intro="Open the link in your reset email again, or request a new one. Reset links expire after an hour.">
        <Link href="/admin/forgot-password" className="btn btn-dark mt-5 w-full">Request a new link</Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a new password" intro="Use at least 12 characters. You'll sign in again afterwards.">
      <ResetPasswordForm />
    </AuthCard>
  );
}
