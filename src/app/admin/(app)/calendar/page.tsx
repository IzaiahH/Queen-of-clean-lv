import { Suspense } from "react";
import { PageHeader } from "@/components/admin/AdminShell";
import { CalendarView } from "@/components/admin/CalendarView";
import { can } from "@/lib/auth/permissions";
import { requirePage } from "@/lib/auth/session";
import { staffFormOptions } from "@/lib/server/admin-queries";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const user = await requirePage("schedule.view");
  const [settings, opts] = await Promise.all([getSettings(), staffFormOptions()]);
  const businessHours = Object.entries(settings.booking.operating_hours)
    .filter(([, h]) => h)
    .map(([iso, h]) => ({ daysOfWeek: [Number(iso) % 7], startTime: h!.open, endTime: h!.close }));
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Schedule" title="Calendar" />
      <Suspense>
        <CalendarView tz={settings.booking.timezone} services={opts.services} cleaners={opts.cleaners} areas={opts.areas} businessHours={businessHours}
          canMoney={can(user.role, "finance.view")} defaultChecklist={settings.recurring.default_checklist} />
      </Suspense>
    </div>
  );
}
