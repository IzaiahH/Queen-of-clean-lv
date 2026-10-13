import Link from "next/link";
import { PageHeader } from "@/components/admin/AdminShell";
import {
  BookingSettings, BusinessSettings, NotificationSettings, OperationsSettings, PolicySettings, RetryEmailButton, TeamEditor, TestimonialsEditor,
} from "@/components/admin/SettingsEditors";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { authProvider, requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { emailConfigured } from "@/lib/server/email";
import { getSettings } from "@/lib/server/settings";
import { listStaff } from "@/lib/server/staff";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePage("settings.edit");
  const canTeam = can(user.role, "users.manage");
  const tabs = [
    ["business", "Business"], ["booking", "Booking"], ["policies", "Policies"], ["notifications", "Emails"],
    ["operations", "Operations"], ["testimonials", "Testimonials"], ...(canTeam ? [["team", "Team logins"]] : []),
  ] as const;
  const requested = (await searchParams).tab ?? "business";
  const tab = tabs.some(([k]) => k === requested) ? requested : "business";
  const settings = await getSettings();
  const tz = settings.booking.timezone;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Business" title="Settings">
        <p className="mt-1 text-sm text-muted">Changes take effect as soon as they are saved.</p>
      </PageHeader>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Settings sections">
        {tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white hover:border-gold"}`}>{l}</Link>)}
      </nav>

      {tab === "business" && <BusinessSettings initial={settings.business} />}
      {tab === "booking" && <BookingSettings initial={settings.booking} />}
      {tab === "policies" && <PolicySettings initial={settings.policies} />}
      {tab === "notifications" && <EmailsTab settings={settings} tz={tz} />}
      {tab === "operations" && <OperationsSettings recurring={settings.recurring} privacy={settings.privacy} />}
      {tab === "testimonials" && <TestimonialsTab />}
      {tab === "team" && canTeam && <TeamTab currentUserId={user.id} />}
    </div>
  );
}

async function EmailsTab({ settings, tz }: { settings: Awaited<ReturnType<typeof getSettings>>; tz: string }) {
  const log = await db()<{ id: string; template: string; recipient: string; subject: string; status: string; error: string | null; attempts: number; created_at: Date; customer_id: string | null; customer: string | null }[]>`
    select m.id, m.template, m.recipient, m.subject, m.status, m.error, m.attempts, m.created_at, m.customer_id, c.full_name as customer
      from communications m left join customers c on c.id = m.customer_id order by m.created_at desc limit 50`;
  return (
    <div className="space-y-5">
      <NotificationSettings initial={settings.notifications} emailReady={emailConfigured()} templates={settings.email_templates} />
      <section className="card">
        <h2 className="border-b border-line px-5 py-4 font-serif text-xl">Recent emails</h2>
        {log.length === 0 ? <p className="p-5 text-sm text-muted">No emails yet.</p> : (
          <ul className="divide-y divide-line">
            {log.map((m) => (
              <li key={m.id} className="space-y-1 px-5 py-3 text-sm sm:flex sm:items-start sm:gap-3 sm:space-y-0">
                <div className="flex items-center justify-between gap-2 sm:contents">
                  <StatusBadge status={m.status === "sent" ? "completed" : m.status === "failed" ? "cancelled" : "pending"} label={m.status === "sent" ? "Sent" : m.status === "failed" ? "Failed" : m.status === "skipped" ? "Not sent" : "Queued"} />
                  {["failed", "skipped"].includes(m.status) && <span className="sm:order-last"><RetryEmailButton id={m.id} /></span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{m.subject || m.template}</p>
                  <p className="text-muted [overflow-wrap:anywhere]">{m.customer_id ? <Link className="link" href={`/admin/customers/${m.customer_id}`}>{m.customer}</Link> : null}{m.customer_id ? " · " : ""}{m.recipient} · {formatDateTime(m.created_at, tz)}{m.attempts > 1 ? ` · ${m.attempts} attempts` : ""}</p>
                  {m.error && <p className="text-status-cancelled">{m.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

async function TestimonialsTab() {
  const rows = await db()<{ id: string; author_name: string; body: string; context: string; permission_confirmed: boolean; published: boolean; sort: number }[]>`
    select id, author_name, body, context, permission_confirmed, published, sort from testimonials order by sort, created_at`;
  return <TestimonialsEditor items={Array.from(rows).map((r) => ({ ...r }))} />;
}

async function TeamTab({ currentUserId }: { currentUserId: string }) {
  const [staff, cleaners] = await Promise.all([
    listStaff(),
    db()<{ id: string; full_name: string }[]>`select id, full_name from cleaners where active order by full_name`,
  ]);
  return <TeamEditor staff={staff} cleaners={Array.from(cleaners).map((c) => ({ ...c }))} currentUserId={currentUserId} provider={authProvider()} />;
}
