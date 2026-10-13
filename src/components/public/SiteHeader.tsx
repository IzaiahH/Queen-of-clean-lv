"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#areas", label: "Service areas" },
  { href: "/#faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ businessName, phone, logo = null }: { businessName: string; phone: string; logo?: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the menu after navigating (adjusting state during render, not in an effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="on-dark sticky top-0 z-40 border-b border-gold/25 bg-obsidian/95 text-ivory backdrop-blur supports-[backdrop-filter]:bg-obsidian/85">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-ivory focus:px-3 focus:py-2 focus:text-obsidian">
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-6">
        <Link href="/" className="rounded-md" aria-label={`${businessName} home`}>
          <Logo name={businessName} imageSrc={logo} />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-semibold text-ivory/80 transition hover:text-champagne aria-[current=page]:text-champagne" aria-current={pathname === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/quote" className="btn btn-primary btn-sm hidden sm:inline-flex">
            Get My Quote
          </Link>
          <button type="button" className="inline-flex size-11 items-center justify-center rounded-md text-champagne lg:hidden" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((v) => !v)}>
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-menu" className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-obsidian px-6 pb-10 pt-6 lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="border-b border-gold/15 py-4 font-display text-2xl text-ivory hover:text-champagne">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 grid gap-3">
            <Link href="/quote" className="btn btn-primary btn-lg w-full">
              Get My Quote
            </Link>
            <Link href="/quote?intent=book" className="btn btn-outline btn-lg w-full">
              Book a Cleaning
            </Link>
            {phone && (
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-2 text-center text-sm text-champagne/80">
                Call {phone}
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
