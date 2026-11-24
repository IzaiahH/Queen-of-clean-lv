import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

/** The full-screen frame shared by sign-in and password-reset pages (Phase 1 brand styling). */
export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo variant="wordmark" height={150} priority /></div>
        <div className="card p-6 text-charcoal">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
