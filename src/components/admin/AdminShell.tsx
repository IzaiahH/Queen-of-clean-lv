"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BarChart3, CalendarDays, ClipboardList, Contact, DollarSign, FileSpreadsheet, LayoutDashboard, ListChecks, LogOut, Menu, Settings, Sparkles, Tag, Users, X } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { logoutAction } from "@/app/admin/actions/auth";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/admin": LayoutDashboard,
  "/admin/calendar": CalendarDays,
  "/admin/appointments": ListChecks,
  "/admin/customers": Contact,
  "/admin/quotes": ClipboardList,
  "/admin/cleaners": Users,
  "/admin/pricing": Tag,
  "/admin/finance": DollarSign,
  "/admin/reports": BarChart3,
  "/admin/import-export": FileSpreadsheet,
  "/admin/settings": Settings,
  "/admin/my-jobs": Sparkles,
};

export function AdminShell({ nav, user, badges, children }: { nav: { href: string; label: string }[]; user: { name: string; role: string }; badges: Record<string, number>; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the menu after navigating (adjusting state during render, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  const links = (
    <nav aria-label="Admin" className="flex flex-col gap-0.5 px-3">
      {nav.map((n) => {
        const Icon = ICONS[n.href] ?? LayoutDashboard;
        const on = active(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={`group flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-semibold transition ${on ? "bg-gold/15 text-champagne shadow-[inset_2px_0_0_var(--color-gold)]" : "text-ivory/70 hover:bg-white/5 hover:text-ivory"}`}>
            <Icon className={`size-4.5 ${on ? "text-gold" : "text-ivory/50 group-hover:text-champagne"}`} />
            <span className="flex-1">{n.label}</span>
            {badges[n.href] ? <span className="rounded-full bg-gold px-2 py-0.5 text-[0.7rem] font-bold text-obsidian">{badges[n.href]}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-gold/15 px-5 py-4">
      <p className="text-sm font-semibold text-ivory">{user.name}</p>
      <p className="text-xs text-ivory/50">{user.role}</p>
      <form action={logoutAction} className="mt-3">
        <button className="inline-flex items-center gap-2 text-sm text-champagne/80 hover:text-champagne"><LogOut className="size-4" aria-hidden /> Sign out</button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="on-dark sticky top-0 hidden h-dvh flex-col bg-obsidian lg:flex">
        <div className="px-5 py-5"><Link href="/admin" aria-label="Dashboard"><Logo /></Link></div>
        <div className="gold-rule mx-5 mb-4" />
        <div className="flex-1 overflow-y-auto">{links}</div>
        {footer}
      </aside>
      <div className="min-w-0">
        <header className="on-dark sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gold/20 bg-obsidian px-4 lg:hidden">
          <Link href="/admin" aria-label="Dashboard"><Logo /></Link>
          <button type="button" className="inline-flex size-11 items-center justify-center text-champagne" aria-expanded={open} aria-controls="admin-drawer" onClick={() => setOpen(true)}>
            <Menu aria-hidden /><span className="sr-only">Open navigation</span>
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
            <button type="button" className="absolute inset-0 bg-obsidian/60" aria-label="Close navigation" onClick={() => setOpen(false)} />
            <div id="admin-drawer" className="on-dark absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-obsidian">
              <div className="flex items-center justify-between px-5 py-4">
                <Logo />
                <button type="button" className="text-champagne" onClick={() => setOpen(false)}><X aria-hidden /><span className="sr-only">Close</span></button>
              </div>
              <div className="flex-1 overflow-y-auto">{links}</div>
              {footer}
            </div>
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[90rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
