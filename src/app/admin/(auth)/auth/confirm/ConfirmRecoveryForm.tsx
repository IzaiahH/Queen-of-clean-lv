"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmRecoveryAction } from "@/app/admin/actions/recovery";

export function ConfirmRecoveryForm({ tokenHash }: { tokenHash: string }) {
  const [state, action, pending] = useActionState(confirmRecoveryAction, undefined);
  return (
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="token_hash" value={tokenHash} />
      {state?.error && (
        <p className="field-error" role="alert">
          {state.error}{" "}
          <Link href="/admin/forgot-password" className="underline underline-offset-4">Request a new link</Link>
        </p>
      )}
      <button type="submit" className="btn btn-dark w-full" disabled={pending}>{pending ? "Checking…" : "Continue"}</button>
    </form>
  );
}
