"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Day = { date: string; label: string; slots: { start: string; label: string }[] };

export function ManageActions({ token, insideNotice, noticeHours, policy }: { token: string; insideNotice: boolean; noticeHours: number; policy: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "cancel" | "reschedule">("none");
  const [message, setMessage] = useState("");
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState<string>("");
  const [slot, setSlot] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [feedback, setFeedback] = useState("");

  async function loadDays(from?: string) {
    setDays(null);
    const res = await fetch(`/api/manage/${token}/availability${from ? `?from=${from}` : ""}`);
    const data = await res.json();
    if (res.ok) {
      setDays(data.days);
      setDay(data.days.find((d: Day) => d.slots.length)?.date ?? data.days[0]?.date ?? "");
    } else {
      setFeedback(data.error ?? "Couldn't load times");
      setDays([]);
    }
  }

  async function send() {
    setState("sending");
    const res = await fetch(`/api/manage/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: mode, requested_start: mode === "reschedule" ? slot : null, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setState("error");
      setFeedback(data.error ?? "Something went wrong.");
      return;
    }
    setState("done");
    setFeedback(data.message);
    router.refresh();
  }

  if (state === "done") return <p className="card mt-6 p-5 text-sm font-semibold" role="status">{feedback}</p>;

  const selectedDay = days?.find((d) => d.date === day);
  return (
    <div className="mt-6 space-y-4">
      {mode === "none" && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn btn-outline flex-1" onClick={() => { setMode("reschedule"); void loadDays(); }}>Request a different time</button>
          <button type="button" className="btn btn-ghost flex-1 text-danger" onClick={() => setMode("cancel")}>Cancel appointment</button>
        </div>
      )}
      {mode === "cancel" && (
        <div className="card p-5">
          <h2 className="text-2xl font-semibold">Cancel this appointment?</h2>
          {insideNotice ? (
            <p className="mt-2 text-sm text-status-pending">Your appointment is less than {noticeHours} hours away, so your cancellation will be sent to our team for review. {policy}</p>
          ) : (
            <p className="mt-2 text-sm text-muted">Your appointment will be cancelled right away and the time released.</p>
          )}
          <label className="field-label mt-4" htmlFor="cancel-msg">Reason (optional)</label>
          <textarea id="cancel-msg" className="input" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          {state === "error" && <p className="field-error" role="alert">{feedback}</p>}
          <div className="mt-4 flex gap-3">
            <button type="button" className="btn btn-danger" disabled={state === "sending"} onClick={send}>{state === "sending" ? "Sending…" : insideNotice ? "Send cancellation request" : "Cancel appointment"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("none")}>Keep my appointment</button>
          </div>
        </div>
      )}
      {mode === "reschedule" && (
        <div className="card p-5">
          <h2 className="text-2xl font-semibold">Request a new time</h2>
          <p className="mt-1 text-sm text-muted">Your current time stays reserved until we confirm the change.</p>
          {days === null ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Checking the calendar…</p>
          ) : (
            <>
              <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
                {days.map((d) => (
                  <button key={d.date} type="button" disabled={!d.slots.length} onClick={() => setDay(d.date)} aria-pressed={d.date === day} className={`min-w-[4.5rem] rounded-[var(--radius-control)] border px-2 py-2 text-xs font-semibold ${d.date === day ? "border-gold bg-obsidian text-champagne" : "border-line"} disabled:opacity-40`}>
                    {d.label}
                  </button>
                ))}
              </div>
              {days.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(`${days[days.length - 1].date}T12:00:00`); d.setDate(d.getDate() + 1); void loadDays(d.toISOString().slice(0, 10)); }}>Next week →</button>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {selectedDay?.slots.map((s) => (
                  <button key={s.start} type="button" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)} className={`min-h-11 rounded-[var(--radius-control)] border text-sm font-semibold ${slot === s.start ? "border-gold bg-gold text-obsidian" : "border-line"}`}>{s.label}</button>
                ))}
              </div>
            </>
          )}
          <label className="field-label mt-4" htmlFor="rs-msg">Message (optional)</label>
          <textarea id="rs-msg" className="input" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          {state === "error" && <p className="field-error" role="alert">{feedback}</p>}
          <div className="mt-4 flex gap-3">
            <button type="button" className="btn btn-dark" disabled={state === "sending" || (!slot && !message)} onClick={send}>{state === "sending" ? "Sending…" : "Send request"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setMode("none")}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
