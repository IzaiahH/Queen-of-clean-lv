import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/AdminShell";
import { CleanerForm, HoursEditor, TimeOffEditor } from "@/components/admin/CleanerEditors";
import { Stat } from "@/components/admin/Stat";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { listServices } from "@/lib/server/catalog";
import { getCleaner } from "@/lib/server/cleaners";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime, minutesLabel } from "@/lib/time";

export const metadata = { title: "Cleaner" };

export default async function CleanerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("cleaners.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [d, services, settings] = await Promise.all([getCleaner(id), listServices(db()), getSettings()]);
  if (!d) notFound();
  const tz = settings.booking.timezone;
  const canEdit = can(user.role, "cleaners.edit");
  const canPay = can(user.role, "cleaners.pay");
  const c = d.c;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Cleaner" title={c.full_name}>
        <p className="mt-1 text-sm text-muted">{c.active ? "Active" : "Inactive"} · {d.login ? `Signs in as ${d.login.email}${d.login.active ? "" : " (disabled)"}` : "No login"}{can(user.role, "users.manage") && <> · <Link href="/admin/settings?tab=team" className="font-semibold text-gold-ink">Manage logins</Link></>}</p>
      </PageHeader>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Jobs (30 days)" value={d.stats.jobs} />
        <Stat label="Hours logged" value={minutesLabel(d.stats.minutes)} note="Last 30 days" />
        {canPay && <Stat label="Pay recorded" value={formatCents(d.stats.pay_cents)} note="Last 30 days" />}
        <Stat label="Upcoming" value={d.upcoming.length} note="Assigned jobs" />
      </section>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-4 text-2xl font-semibold">Profile</h2>
          {canEdit ? <CleanerForm id={c.id} initial={{ ...c, email: c.email ?? "", phone: c.phone ?? "" }} services={services.map((s) => ({ slug: s.slug, name: s.name }))} canPay={canPay} />
            : <p className="text-sm text-muted">{c.email ?? ""} {c.phone ?? ""}</p>}
        </section>
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Working hours</h2>
            <p className="mb-3 text-sm text-muted">Online booking only offers times inside these hours (and the business hours in Settings).</p>
            {canEdit ? <HoursEditor cleanerId={c.id} initial={d.hours} /> : <p className="text-sm">{d.hours.length} shifts</p>}
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-2xl font-semibold">Time off</h2>
            {canEdit ? <TimeOffEditor cleanerId={c.id} items={d.timeOff} tz={tz} /> : null}
          </section>
          <section className="card p-5">
            <h2 className="text-2xl font-semibold">Upcoming jobs</h2>
            {d.upcoming.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing assigned.</p> : (
              <ul className="mt-3 divide-y divide-line text-sm">{d.upcoming.map((a) => (
                <li key={a.id}><Link href={`/admin/appointments/${a.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-cream/40"><span><span className="font-semibold">{formatDateTime(a.starts_at, tz)}</span><span className="block text-xs text-muted">{a.customer_name} · {a.service_name} · {minutesLabel(a.estimated_minutes)}</span></span><StatusBadge status={a.status} /></Link></li>
              ))}</ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
