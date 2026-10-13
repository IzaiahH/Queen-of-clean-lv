"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Native <dialog> modal: focus trapping, Escape and backdrop handled by the browser. `side` renders a slide-over panel (bottom sheet on phones). */
export function Dialog({ open, onClose, title, children, side = false, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; side?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const cls = side
    ? "m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl rounded-none sm:rounded-l-[var(--radius-card)] max-sm:mt-auto max-sm:h-[92dvh] max-sm:rounded-t-[var(--radius-card)]"
    : `m-auto w-[calc(100%-2rem)] ${wide ? "max-w-3xl" : "max-w-lg"} rounded-[var(--radius-card)]`;
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} className={`${cls} border border-line bg-ivory p-0 text-charcoal shadow-[var(--shadow-lift)] backdrop:bg-obsidian/60`} aria-label={title}>
      {open && (
        <div className="flex h-full max-h-[inherit] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
            <h2 className="text-2xl font-semibold">{title}</h2>
            <button type="button" className="btn btn-ghost size-10 p-0" onClick={onClose} aria-label="Close"><X className="size-5" aria-hidden /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
