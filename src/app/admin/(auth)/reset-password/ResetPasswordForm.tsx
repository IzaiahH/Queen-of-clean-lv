"use client";

import { useActionState } from "react";
import { setNewPasswordAction } from "@/app/admin/actions/recovery";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(setNewPasswordAction, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label htmlFor="password" className="field-label">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required className="input" />
      </div>
      <div>
        <label htmlFor="confirm" className="field-label">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required className="input" />
      </div>
      {state?.error && <p className="field-error" role="alert">{state.error}</p>}
      <button type="submit" className="btn btn-dark w-full" disabled={pending}>{pending ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
