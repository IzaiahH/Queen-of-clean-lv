"use client";

import { startDraftAction } from "@/app/admin/actions/pricing";
import { useAction } from "@/components/ui/useAction";

export function StartDraftButton() {
  const { run, pending } = useAction();
  return <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => startDraftAction())}>Start editing prices</button>;
}
