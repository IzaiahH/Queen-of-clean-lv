import Link from "next/link";
import { AuthCard } from "@/components/admin/AuthCard";
import { ConfirmRecoveryForm } from "./ConfirmRecoveryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password", robots: { index: false } };

/**
 * Landing page for the link in the password-reset email. It does NOT use the link by itself:
 * the one-time link is only spent when the person taps the button, so email scanners and
 * link previews that open it automatically can't use it up.
 */
export default async function ConfirmRecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : "";
  const type = typeof sp.type === "string" ? sp.type : "";
  if (!tokenHash || type !== "recovery")
    return (
      <AuthCard title="Link not valid" intro="This reset link is incomplete or has expired.">
        <Link href="/admin/forgot-password" className="btn btn-dark mt-5 w-full">Request a new link</Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Reset your password" intro="Tap continue to choose a new password.">
      <ConfirmRecoveryForm tokenHash={tokenHash} />
    </AuthCard>
  );
}
