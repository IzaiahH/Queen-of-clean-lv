"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";

export function ContactForm() {
  const [startedAt] = useState(() => Date.now());
  const [values, setValues] = useState({ name: "", email: "", phone: "", message: "", website: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setErrors({});
    try {
      const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, started_at: startedAt }) });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.fields ?? {});
        setMessage(data.error ?? "Something went wrong.");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setMessage("We couldn't reach the server. Check your connection and try again.");
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <div className="card p-8 text-center" role="status">
        <h2 className="text-3xl font-semibold">Thank you — message received</h2>
        <p className="mt-2 text-muted">We&apos;ll get back to you as soon as we can.</p>
      </div>
    );

  return (
    <form onSubmit={submit} noValidate className="card space-y-5 p-6 sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" error={errors.name}>{(p) => <input {...p} className="input" autoComplete="name" value={values.name} onChange={set("name")} required />}</Field>
        <Field label="Email" error={errors.email}>{(p) => <input {...p} className="input" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={set("email")} required />}</Field>
      </div>
      <Field label="Phone" optional error={errors.phone}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" value={values.phone} onChange={set("phone")} />}</Field>
      <Field label="How can we help?" error={errors.message}>{(p) => <textarea {...p} className="input" rows={5} value={values.message} onChange={set("message")} required />}</Field>
      <div aria-hidden className="absolute -left-[9999px]">
        <label>Website<input tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} /></label>
      </div>
      {state === "error" && <p className="field-error" role="alert">{message}</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send message"}</button>
      <p className="text-xs text-muted">Please don&apos;t include door codes or alarm codes here. We&apos;ll ask for access details securely when you book.</p>
    </form>
  );
}
