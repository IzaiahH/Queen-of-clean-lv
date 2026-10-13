export function Stat({ label, value, note, tone = "default", href }: { label: string; value: React.ReactNode; note?: string; tone?: "default" | "gold" | "estimate" | "warn"; href?: string }) {
  const body = (
    <div className={`card h-full p-4 ${tone === "gold" ? "border-gold/60" : ""} ${tone === "estimate" ? "border-dashed" : ""} ${href ? "transition hover:shadow-[var(--shadow-lift)]" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold [font-variant-numeric:lining-nums_tabular-nums] ${tone === "gold" ? "text-gold-ink" : tone === "warn" ? "text-status-pending" : ""}`}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
  return href ? <a href={href} className="block">{body}</a> : body;
}
