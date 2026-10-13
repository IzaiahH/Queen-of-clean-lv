"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error" | "info"; text: string; detail?: string };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "error" ? 9000 : 5500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[var(--radius-card)] border bg-[#fffdf8] p-4 shadow-[var(--shadow-lift)] ${t.kind === "error" ? "border-danger/40" : t.kind === "success" ? "border-success/40" : "border-line"}`}>
            {t.kind === "success" ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> : t.kind === "error" ? <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden /> : <Info className="size-5 shrink-0 text-gold" aria-hidden />}
            <div className="flex-1 text-sm">
              <p className="font-semibold">{t.text}</p>
              {t.detail && <p className="mt-0.5 text-muted">{t.detail}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}><X className="size-4 text-muted" aria-hidden /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
