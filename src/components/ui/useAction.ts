"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "./Toast";

export type ActionResponse = {
  ok: boolean; message?: string; error?: string; conflicts?: string[]; email?: { status: string; error?: string } | null; data?: unknown;
  fields?: Record<string, string>;
};

function emailDetail(email: ActionResponse["email"]) {
  if (!email) return undefined;
  if (email.status === "sent") return "Email sent to the customer.";
  if (email.status === "skipped") return `No email sent: ${email.error}.`;
  return `Email failed: ${email.error}. Retry from the communication log.`;
}

/**
 * Runs a server action, shows an honest toast (including whether an email really went out),
 * asks before saving over scheduling conflicts, and refreshes server data.
 * When the server says which fields are wrong, those go to `fields` for the form to outline in red
 * (see FormErrors) instead of a toast.
 */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [conflicts, setConflicts] = useState<{ list: string[]; retry: () => void } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function run(fn: (force: boolean) => Promise<ActionResponse>, opts: { onSuccess?: (r: ActionResponse) => void } = {}) {
    const exec = (force: boolean) =>
      start(async () => {
        try {
          const r = await fn(force);
          if (r.ok) {
            setConflicts(null);
            setFields({});
            toast({ kind: r.email?.status === "failed" ? "info" : "success", text: r.message ?? "Saved.", detail: emailDetail(r.email) });
            opts.onSuccess?.(r);
            router.refresh();
          } else if (r.fields && Object.keys(r.fields).length) {
            setFields(r.fields);
          } else if (r.conflicts?.length && !force) {
            setConflicts({ list: r.conflicts, retry: () => exec(true) });
          } else {
            toast({ kind: "error", text: r.error ?? "That didn't work.", detail: r.conflicts?.join("; ") });
          }
        } catch (e) {
          toast({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
        }
      });
    exec(false);
  }
  return { run, pending, conflicts, clearConflicts: () => setConflicts(null), fields, clearFields: () => setFields({}) };
}
