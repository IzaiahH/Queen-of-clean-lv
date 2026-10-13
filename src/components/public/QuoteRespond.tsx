"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Day = { date: string; label: string; slots: { start: string; label: string }[] };

export function QuoteRespond({ token, status, hasAppointment }: { token: string; status: string; hasAppointment: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState<Day[] | null>(null);
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [done, setDone] = useState<{ manage_url: string; reference: string } | null>(null);

  const call = async (payload: object) => {
    const res = await fetch(`/api/public-quote/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return { res, data: await res.json().catch(() => ({})) };
  };

  async function accept() {
    setBusy(true);
    setError("");
    const { res, data } = await call({ action: "accept" });
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong");
    router.refresh();
  }

  async function loadDays(from?: string) {
    setDays(null);
    const { res, data } = await call({ action: "slots", from });
    if (!res.ok) return setError(data.error ?? "Couldn't load times");
    setDays(data.days);
    setDay(data.days.find((d: Day) => d.slots.length)?.date ?? "");
  }

  async function book() {
    if (!slot) return;
    setBusy(true);
    setError("");
    const { res, data } = await call({ action: "book", slot_start: slot });
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setSlot(null);
      void loadDays();
      return;
    }
    setDone(data);
  }

  if (done)
    return (
      <div className="card mt-6 p-6" role="status">
        <p className="text-xl font-semibold">Request received — reference {done.reference}</p>
        <p className="mt-1 text-sm text-muted">Your appointment is pending review. We&apos;ll confirm by email.</p>
        <Link href={done.manage_url} className="btn btn-dark mt-4">View my appointment</Link>
      </div>
    );

  return (
    <div className="mt-6 space-y-4">
      {error && <p className="field-error" role="alert">{error}</p>}
      {["sent", "pending_customer"].includes(status) && (
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={accept} disabled={busy}>{busy ? "Saving…" : "Accept this quote"}</button>
      )}
      {status === "accepted" && !hasAppointment && (
        <div className="card p-5">
          <h2 className="text-2xl font-semibold">Choose a time</h2>
          {days === null ? (
            <button type="button" className="btn btn-dark mt-3" onClick={() => loadDays()}>See available times</button>
          ) : (
            <>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                {days.map((d) => (
                  <button key={d.date} type="button" disabled={!d.slots.length} aria-pressed={d.date === day} onClick={() => setDay(d.date)} className={`min-w-[4.5rem] rounded-[var(--radius-control)] border px-2 py-2 text-xs font-semibold ${d.date === day ? "border-gold bg-obsidian text-champagne" : "border-line"} disabled:opacity-40`}>{d.label}</button>
                ))}
              </div>
              {days.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const d = new Date(`${days[days.length - 1].date}T12:00:00`); d.setDate(d.getDate() + 1); void loadDays(d.toISOString().slice(0, 10)); }}>Next week →</button>}
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {days.find((d) => d.date === day)?.slots.map((s) => (
                  <button key={s.start} type="button" aria-pressed={slot === s.start} onClick={() => setSlot(s.start)} className={`min-h-11 rounded-[var(--radius-control)] border text-sm font-semibold ${slot === s.start ? "border-gold bg-gold text-obsidian" : "border-line"}`}>{s.label}</button>
                ))}
              </div>
              <button type="button" className="btn btn-primary mt-4" disabled={!slot || busy} onClick={book}>{busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Request this time</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
