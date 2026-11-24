"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/app/admin/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label htmlFor="email" className="field-label">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      <div>
        <label htmlFor="password" className="field-label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      {state?.error && <p className="field-error" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-dark w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-center text-sm">
        <Link href="/admin/forgot-password" className="underline underline-offset-4">Forgot password?</Link>
      </p>
    </form>
  );
}
