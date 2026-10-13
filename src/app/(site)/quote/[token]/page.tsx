import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteRespond } from "@/components/public/QuoteRespond";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/pricing/rules";
import { quoteByToken } from "@/lib/server/public-lookup";
import { quoteAmount } from "@/lib/server/quotes";
import { getSettings } from "@/lib/server/settings";
import { formatDate, minutesLabel } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your quote", robots: { index: false } };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [q, settings] = await Promise.all([quoteByToken(token), getSettings()]);
  if (!q) notFound();
  const tz = settings.booking.timezone;
  const expired = q.status === "expired" || (q.expires_at && q.expires_at < new Date() && q.status !== "accepted");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="eyebrow">Your quote · {q.reference}</p>
      <h1 className="mt-2 text-4xl font-semibold">{q.customer_first ? `Hi ${q.customer_first}` : "Your quote"}</h1>
      {q.status === "draft" ? (
        <p className="card mt-6 p-6">We&apos;re reviewing your details and will email your confirmed quote soon.</p>
      ) : (
        <div className="frame mt-6 rounded-sm bg-[#fffdf8]">
          <div className="on-dark flex items-start justify-between gap-4 bg-obsidian px-6 py-6 text-ivory">
            <div>
              <p className="text-sm text-ivory/70">{q.service_name} · {FREQUENCY_LABELS[q.frequency as Frequency] ?? q.frequency}</p>
              <p className="gold-text mt-1 font-display text-5xl font-semibold">{formatCents(quoteAmount(q))}</p>
              <p className="text-sm text-ivory/70">{q.recurring_cents !== null ? "per visit" : "one-time"} · about {minutesLabel(q.estimated_minutes)}</p>
            </div>
            <StatusBadge status={expired ? "expired" : q.status} />
          </div>
          {q.override_cents === null ? (
            <ul className="divide-y divide-line/70 text-sm">
              {q.breakdown.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-4 px-6 py-2.5"><span>{l.label}</span><span className="tabular-nums">{formatCents(l.amount_cents)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="px-6 py-4 text-sm text-muted">This price was prepared by our team after reviewing your details.</p>
          )}
          <div className="space-y-2 border-t border-line px-6 py-4 text-sm text-muted">
            {q.breakdown.notes?.map((n) => <p key={n}>{n}</p>)}
            {q.expires_at && <p>Valid until {formatDate(q.expires_at, tz)}.</p>}
            <p>This is an estimate based on the details provided. If the home&apos;s condition or the scope differs, we&apos;ll discuss any change before starting.</p>
          </div>
        </div>
      )}
      {!expired && q.status !== "draft" && <QuoteRespond token={token} status={q.status} hasAppointment={q.has_appointment} />}
      {expired && <p className="mt-6 text-sm">This quote has expired. <Link className="underline" href="/quote">Request a new quote</Link>.</p>}
    </div>
  );
}
