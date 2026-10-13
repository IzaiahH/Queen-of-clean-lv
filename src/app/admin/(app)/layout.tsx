import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";
import { getCurrentUser } from "@/lib/auth/session";
import { ADMIN_NAV, ROLE_LABELS, can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Admin · Queen of Clean LV" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");
  const nav = user.role === "cleaner" ? [{ href: "/admin/my-jobs", label: "My jobs" }] : ADMIN_NAV.filter((n) => can(user.role, n.cap)).map(({ href, label }) => ({ href, label }));
  const badges: Record<string, number> = {};
  if (user.role !== "cleaner") {
    const [c] = await db()<{ pending: number; attention: number; quotes: number }[]>`
      select (select count(*)::int from appointments where status = 'pending' and starts_at > now() - interval '1 day') as pending,
             (select count(*)::int from appointments where needs_attention is not null and status in ('pending','confirmed') and starts_at > now()) as attention,
             (select count(*)::int from quotes where status = 'draft') as quotes`;
    badges["/admin/appointments"] = c.pending + c.attention;
    badges["/admin/quotes"] = c.quotes;
  }
  return (
    <ToastProvider>
      <AdminShell nav={nav} user={{ name: user.full_name, role: ROLE_LABELS[user.role] }} badges={badges}>
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
