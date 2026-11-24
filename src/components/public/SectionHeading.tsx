export function SectionHeading({ eyebrow, title, intro, dark = false, as: Tag = "h2" }: { eyebrow: string; title: string; intro?: string; dark?: boolean; as?: "h1" | "h2" }) {
  return (
    <div className="text-center">
      <p className={dark ? "eyebrow eyebrow-on-dark" : "eyebrow"}>{eyebrow}</p>
      <Tag className={`mx-auto mt-3 max-w-2xl text-balance text-4xl font-semibold leading-tight sm:text-5xl ${dark ? "text-ivory" : "text-charcoal"}`}>{title}</Tag>
      <div className="gold-divider mt-5" aria-hidden>
        <span className="size-1.5 rotate-45 bg-gold" />
      </div>
      {intro && <p className={`mx-auto mt-5 max-w-2xl leading-relaxed ${dark ? "text-ivory/70" : "text-muted"}`}>{intro}</p>}
    </div>
  );
}
