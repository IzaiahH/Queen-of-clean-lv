import { notFound } from "next/navigation";
import { ManageActions } from "@/components/public/ManageActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/pricing/rules";
import { appointmentByToken } from "@/lib/server/public-lookup";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime, minutesLabel } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your appointment", robots: { index: false } };

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [a, settings] = await Promise.all([appointmentByToken(token), getSettings()]);
  if (!a) notFound();
  const tz = settings.booking.timezone;
  const changeable = ["pending", "confirmed"].includes(a.status) && a.starts_at > new Date();
  // eslint-disable-next-line react-hooks/purity -- server component, rendered once per request
  const hoursUntil = (a.starts_at.getTime() - Date.now()) / 3_600_000;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <p className="eyebrow">Your appointment</p>
      <h1 className="mt-2 text-4xl font-semibold">Hi {a.customer_first}</h1>
      <div className="card mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-sm">{a.reference}</p>
          <StatusBadge status={a.status} />
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">Service</dt><dd className="text-right font-medium">{a.service_name}{a.frequency !== "one_time" && FREQUENCY_LABELS[a.frequency as Frequency] ? ` · ${FREQUENCY_LABELS[a.frequency as Frequency]}` : ""}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{a.status === "pending" ? "Requested time" : "Time"}</dt><dd className="text-right font-medium">{formatDateTime(a.starts_at, tz)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Estimated length</dt><dd className="text-right font-medium">{minutesLabel(a.estimated_minutes)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Address</dt><dd className="text-right font-medium">{a.address}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">{a.status === "confirmed" ? "Agreed price" : "Estimate"}</dt><dd className="text-right font-medium">{a.agreed_price_cents ? formatCents(a.agreed_price_cents) : "Custom quote pending"}{a.requires_review ? " (subject to review)" : ""}</dd></div>
        </dl>
        {a.status === "pending" && <p className="mt-4 rounded-[var(--radius-control)] bg-status-pending-bg p-3 text-sm text-status-pending">Not confirmed yet. {settings.business.response_time_text}</p>}
        {a.open_request && <p className="mt-4 rounded-[var(--radius-control)] bg-cream p-3 text-sm">We received your {a.open_request} request and will reply soon.</p>}
      </div>
      {changeable && !a.open_request && (
        <ManageActions token={token} insideNotice={hoursUntil < settings.policies.cancellation_notice_hours} noticeHours={settings.policies.cancellation_notice_hours} policy={settings.policies.cancellation_policy} />
      )}
      <p className="mt-8 text-center text-sm text-muted">Questions? {settings.business.phone ? `Call ${settings.business.phone}` : "Contact us"}{settings.business.email ? ` or email ${settings.business.email}` : ""}.</p>
    </div>
  );
}
