"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Red box at the top of a form listing what still needs filling in. Shown after Save/Apply
 * when the server rejects specific fields; the matching inputs are outlined in red too.
 */
export function FormErrors({ fields, labels }: { fields: Record<string, string>; labels: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = Object.keys(fields);
  const signature = keys.join("|");
  useEffect(() => {
    if (signature) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [signature]);
  if (!keys.length) return null;
  return (
    <div ref={ref} role="alert" className="rounded-[var(--radius-control)] border-2 border-danger bg-danger/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Please fill in {keys.length === 1 ? "this field" : "these fields"}:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        {keys.map((k) => (
          <li key={k}><span className="font-semibold">{labels[k] ?? k}</span>: {fields[k]}</li>
        ))}
      </ul>
    </div>
  );
}

/** Props for an input that may be in error: red outline + message wiring. */
export function invalid(fields: Record<string, string>, key: string) {
  return fields[key] ? { "aria-invalid": true as const } : {};
}

export function FieldMessage({ fields, name }: { fields: Record<string, string>; name: string }) {
  return fields[name] ? <span className="field-error block">{fields[name]}</span> : null;
}
