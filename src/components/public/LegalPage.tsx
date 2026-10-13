export function LegalPage({ title, body, sections = [], draft = false }: { title: string; body: string; sections?: { title: string; body: string }[]; draft?: boolean }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Policies</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">{title}</h1>
      {draft && <p className="mt-6 rounded-[var(--radius-control)] border border-line bg-cream p-4 text-sm text-charcoal">These policies are being finalized. If you have a question about them, please contact us before booking.</p>}
      <div className="mt-8 space-y-4 whitespace-pre-line leading-relaxed text-charcoal/90">{body}</div>
      {sections.map((s) => (
        <section key={s.title} className="mt-10">
          <h2 className="text-2xl font-semibold">{s.title}</h2>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-charcoal/90">{s.body}</p>
        </section>
      ))}
    </div>
  );
}
