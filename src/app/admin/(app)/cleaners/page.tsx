import Link from "next/link";
import { PageHeader } from "@/components/admin/AdminShell";
import { NewCleanerButton } from "@/components/admin/CleanerEditors";
import { EmptyState } from "@/components/ui/EmptyState";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { listServices } from "@/lib/server/catalog";
import { listCleaners } from "@/lib/server/cleaners";
import { getSettings } from "@/lib/server/settings";
import { formatDate, minutesLabel } from "@/lib/time";

export const metadata = { title: "Cleaners" };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default async function CleanersPage() {
  const user = await requirePage("cleaners.view");
  const [cleaners, services, settings] = await Promise.all([listCleaners(), listServices(db()), getSettings()]);
  const tz = settings.booking.timezone;
  const canPay = can(user.role, "cleaners.pay");
  const svcName = (slug: string) => services.find((s) => s.slug === slug)?.name ?? slug;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Team" title="Cleaners" actions={can(user.role, "cleaners.edit") ? <NewCleanerButton services={services.map((s) => ({ slug: s.slug, name: s.name }))} canPay={canPay} /> : undefined} />
      {cleaners.length === 0 ? (
        <EmptyState title="No cleaners yet">Add each person who cleans (including yourself) with their working hours. Online booking only offers times when someone is available.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cleaners.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/cleaners/${c.id}`} className={`card block h-full p-5 transition hover:shadow-[var(--shadow-lift)] ${c.active ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full font-display text-xl font-semibold text-white" style={{ background: c.color }} aria-hidden>{c.full_name.slice(0, 1)}</span>
                  <div className="min-w-0"><p className="truncate text-lg font-semibold">{c.full_name}</p><p className="truncate text-xs text-muted">{c.active ? "Active" : "Inactive"}{c.has_login ? " · Has login" : ""}{c.phone ? ` · ${c.phone}` : ""}</p></div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-muted">This week</dt><dd className="font-semibold">{c.jobs_week} job{c.jobs_week === 1 ? "" : "s"} · {minutesLabel(c.minutes_week)}</dd></div>
                  <div><dt className="text-xs text-muted">Last 30 days</dt><dd className="font-semibold">{c.jobs_30} completed</dd></div>
                  <div className="col-span-2"><dt className="text-xs text-muted">Hours</dt><dd>{c.hours.length ? c.hours.map((h) => `${DAYS[h.weekday]} ${h.start_time}–${h.end_time}`).join(", ") : <span className="font-semibold text-status-pending">No hours set (not bookable online)</span>}</dd></div>
                  <div className="col-span-2"><dt className="text-xs text-muted">Can perform</dt><dd>{c.capabilities.length ? c.capabilities.map(svcName).join(", ") : "All services"}</dd></div>
                  {canPay && <div className="col-span-2"><dt className="text-xs text-muted">Pay</dt><dd>{c.pay_method === "percent" ? `${c.pay_percent}% of job` : c.pay_method === "per_job" ? `${formatCents(c.pay_rate_cents)} per job` : `${formatCents(c.pay_rate_cents)}/hr`}{c.pay_rate_cents === 0 && c.pay_method !== "percent" ? " (not set)" : ""}</dd></div>}
                  {c.next_off && <div className="col-span-2"><dt className="text-xs text-muted">Next time off</dt><dd>{formatDate(c.next_off, tz)}</dd></div>}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
