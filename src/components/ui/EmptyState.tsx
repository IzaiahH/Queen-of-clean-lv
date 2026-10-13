import { Crown } from "@/components/brand/Crown";

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line bg-[#fffdf8] px-6 py-10 text-center">
      <Crown className="h-7 w-10 opacity-70" />
      <h3 className="mt-3 text-xl font-semibold text-charcoal">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
