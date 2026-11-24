import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { AuthCard } from "@/components/admin/AuthCard";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getCurrentUser()) redirect("/admin");
  const { reset } = await searchParams;
  return (
    <AuthCard title="Team sign in" intro="Private area for Queen of Clean LV staff.">
      {reset === "done" && (
        <p className="mt-4 rounded-sm border border-gold/40 bg-gold/10 px-3 py-2 text-sm" role="status">
          Your password was changed. Sign in with your new password.
        </p>
      )}
      <LoginForm />
    </AuthCard>
  );
}
