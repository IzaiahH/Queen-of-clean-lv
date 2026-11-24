import Link from "next/link";
import { AuthCard } from "@/components/admin/AuthCard";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" intro="Enter the email you sign in with and we'll send you a link to choose a new password.">
      <ForgotPasswordForm />
      <p className="mt-5 text-center text-sm">
        <Link href="/admin/login" className="underline underline-offset-4">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
