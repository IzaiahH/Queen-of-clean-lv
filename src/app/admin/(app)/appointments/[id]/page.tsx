import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/AdminShell";
import { AppointmentPanel } from "@/components/admin/AppointmentPanel";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { getAppointmentDetail, staffFormOptions } from "@/lib/server/admin-queries";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Appointment" };

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage("schedule.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [detail, opts, settings] = await Promise.all([getAppointmentDetail(id), staffFormOptions(), getSettings()]);
  if (!detail) notFound();
  if (!can(user.role, "cleaners.pay")) {
    detail.assignments = detail.assignments.map((x) => ({ ...x, pay_rate_cents: 0, pay_percent: 0 }));
    detail.labor = detail.labor.map((l) => ({ ...l, pay_cents: 0, pay_basis: "" }));
    detail.laborCents = 0;
    detail.profit = null;
    detail.estimatedLabor = 0;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader eyebrow="Appointment" title={detail.a.customer_name}
        actions={<><Link href={`/admin/customers/${detail.a.customer_id}`} className="btn btn-outline btn-sm">Customer profile</Link><Link href={`/admin/calendar?view=day&date=${new Date(detail.a.starts_at).toISOString().slice(0, 10)}`} className="btn btn-ghost btn-sm">Show on calendar</Link></>} />
      <div className="card p-5">
        <AppointmentPanel detail={detail} cleaners={opts.cleaners} tz={settings.booking.timezone} canMoney={can(user.role, "finance.view")} defaultChecklist={settings.recurring.default_checklist} />
      </div>
    </div>
  );
}
