import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Logo } from "@/components/brand/Logo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/admin");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo variant="wordmark" height={150} priority /></div>
        <div className="card p-6 text-charcoal">
          <h1 className="text-2xl font-semibold">Team sign in</h1>
          <p className="mt-1 text-sm text-muted">Private area for Queen of Clean LV staff.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
