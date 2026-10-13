import { DateTime } from "luxon";
import { PageHeader } from "@/components/admin/AdminShell";
import { MyJobCard, type MyJob } from "@/components/admin/MyJobCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/server/settings";
import { minutesLabel } from "@/lib/time";

export const metadata = { title: "My jobs" };

/** Cleaner view: only jobs assigned to the signed-in cleaner, with what they need on site. No prices or pay. */
export default async function MyJobsPage() {
  const user = await requirePage("jobs.own");
  const settings = await getSettings();
  const tz = settings.booking.timezone;
  if (!user.cleaner_id) return <EmptyState title="Your account isn't linked to a cleaner profile">Ask the owner to link your login to your cleaner profile.</EmptyState>;
  const now = DateTime.now().setZone(tz);
  const rows = await db()<{
    id: string; starts_at: Date; estimated_minutes: number; status: string; customer: string; phone: string | null; address: string; service: string;
    access_instructions: string; internal_notes: string; customer_notes: string; addons: { label: string; quantity: number }[]; checklist: string[]; events: string[];
  }[]>`
    select a.id, a.starts_at, a.estimated_minutes, a.status, c.full_name as customer, c.phone,
           concat_ws(', ', p.address_line1, p.unit, p.city, p.zip) as address, coalesce(s.name, a.service_slug) as service,
           coalesce(nullif(a.access_instructions, ''), p.access_instructions) as access_instructions, a.internal_notes, a.customer_notes, a.addons, a.checklist,
           coalesce((select array_agg(ch.kind) from appointment_changes ch where ch.appointment_id = a.id and ch.kind in ('clock_in','clock_out','cleaner_report')
                      and (ch.to_value->>'cleaner_id')::uuid = ${user.cleaner_id}), '{}') as events
      from appointment_assignments x join appointments a on a.id = x.appointment_id
      join customers c on c.id = a.customer_id join properties p on p.id = a.property_id left join services s on s.slug = a.service_slug
     where x.cleaner_id = ${user.cleaner_id} and a.status in ('pending','confirmed')
       and a.starts_at >= ${now.startOf("day").toJSDate()} and a.starts_at < ${now.plus({ days: 14 }).endOf("day").toJSDate()}
     order by a.starts_at`;
  const jobs = rows.map((r): MyJob & { today: boolean } => ({
    id: r.id, today: DateTime.fromJSDate(r.starts_at).setZone(tz).hasSame(now, "day"),
    when: DateTime.fromJSDate(r.starts_at).setZone(tz).toFormat("cccc, LLL d · h:mm a"), minutes: minutesLabel(r.estimated_minutes), status: r.status,
    customer: r.customer, phone: r.phone, address: r.address, map_url: `https://maps.google.com/?q=${encodeURIComponent(r.address)}`, service: r.service,
    access: r.access_instructions, notes: r.internal_notes, customer_notes: r.customer_notes, addons: (r.addons ?? []).map((a) => (a.quantity > 1 ? `${a.label} × ${a.quantity}` : a.label)),
    checklist: r.checklist?.length ? r.checklist : settings.recurring.default_checklist,
    clocked_in: r.events.includes("clock_in"), clocked_out: r.events.includes("clock_out"), reported: r.events.includes("cleaner_report"),
  }));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader eyebrow={now.toFormat("cccc, LLL d")} title={`Hi ${user.full_name.split(" ")[0]}`} />
      {jobs.length === 0 ? <EmptyState title="No jobs in the next two weeks">New assignments will show up here.</EmptyState> : jobs.map((j) => <MyJobCard key={j.id} job={j} today={j.today} />)}
    </div>
  );
}
