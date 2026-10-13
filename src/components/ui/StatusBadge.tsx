const STYLES: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending review", cls: "bg-status-pending-bg text-status-pending border-status-pending/40 border-dashed" },
  confirmed: { label: "Confirmed", cls: "bg-status-confirmed-bg text-status-confirmed border-status-confirmed/40" },
  completed: { label: "Completed", cls: "bg-status-completed-bg text-status-completed border-status-completed/40" },
  cancelled: { label: "Cancelled", cls: "bg-status-cancelled-bg text-status-cancelled border-status-cancelled/40" },
  declined: { label: "Declined", cls: "bg-status-declined-bg text-status-declined border-status-declined/40" },
  no_show: { label: "No-show", cls: "bg-status-declined-bg text-status-declined border-status-declined/40" },
  // quotes
  draft: { label: "Draft / needs review", cls: "bg-status-pending-bg text-status-pending border-status-pending/40 border-dashed" },
  sent: { label: "Sent", cls: "bg-status-confirmed-bg text-status-confirmed border-status-confirmed/40" },
  pending_customer: { label: "Awaiting customer", cls: "bg-status-confirmed-bg text-status-confirmed border-status-confirmed/40 border-dashed" },
  accepted: { label: "Accepted", cls: "bg-status-completed-bg text-status-completed border-status-completed/40" },
  expired: { label: "Expired", cls: "bg-status-cancelled-bg text-status-cancelled border-status-cancelled/40" },
  // customers / series
  lead: { label: "Lead", cls: "bg-status-pending-bg text-status-pending border-status-pending/40" },
  active: { label: "Active", cls: "bg-status-completed-bg text-status-completed border-status-completed/40" },
  inactive: { label: "Inactive", cls: "bg-status-cancelled-bg text-status-cancelled border-status-cancelled/40" },
  archived: { label: "Archived", cls: "bg-status-cancelled-bg text-status-cancelled border-status-cancelled/40" },
  paused: { label: "Paused", cls: "bg-status-pending-bg text-status-pending border-status-pending/40" },
  // communications
  queued: { label: "Queued", cls: "bg-status-pending-bg text-status-pending border-status-pending/40" },
  failed: { label: "Failed", cls: "bg-status-declined-bg text-status-declined border-status-declined/40" },
  skipped: { label: "Not sent", cls: "bg-status-cancelled-bg text-status-cancelled border-status-cancelled/40" },
  open: { label: "Open", cls: "bg-status-pending-bg text-status-pending border-status-pending/40" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STYLES[status] ?? { label: status, cls: "bg-cream text-charcoal border-line" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold whitespace-nowrap ${s.cls}`}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {label ?? s.label}
    </span>
  );
}

export const STATUS_LABEL = (s: string) => STYLES[s]?.label ?? s;
