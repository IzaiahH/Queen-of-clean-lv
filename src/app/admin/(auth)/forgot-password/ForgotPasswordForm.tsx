"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/admin/actions/recovery";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);
  if (state?.sent)
    return (
      <p className="mt-5 text-sm" role="status">
        If that email belongs to a team account, a reset link is on its way. It works once and expires after an hour. Check your spam folder if you don&apos;t see it.
      </p>
    );
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label htmlFor="email" className="field-label">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </div>
      {state?.error && <p className="field-error" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-dark w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}
