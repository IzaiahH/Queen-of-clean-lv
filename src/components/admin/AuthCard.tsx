import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

/** The dark full-screen frame shared by sign-in and password-reset pages. */
export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="on-dark flex min-h-dvh items-center justify-center bg-obsidian px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo variant="stacked" showTagline /></div>
        <div className="frame rounded-sm bg-ivory p-6 text-charcoal">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
