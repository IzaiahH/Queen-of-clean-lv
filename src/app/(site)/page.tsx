import Link from "next/link";
import { CalendarCheck, ClipboardList, Home, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { Crown } from "@/components/brand/Crown";
import { HeroArt } from "@/components/public/HeroArt";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/pricing/rules";
import { getPublishedPricing, listAreas, listServices } from "@/lib/server/catalog";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Home, title: "Tell us about your home", body: "Bedrooms, bathrooms, condition and any extras. “Not sure” is always an option." },
  { icon: ClipboardList, title: "See your estimate", body: "A clear, line-by-line estimate based on our current pricing — no phone tag." },
  { icon: CalendarCheck, title: "Choose a time", body: "Pick from times that are actually open on our calendar." },
  { icon: ShieldCheck, title: "We confirm", body: "We review every request and confirm by email before your clean." },
];

export default async function HomePage() {
  const [settings, services, areas, pricing, testimonials] = await Promise.all([
    getSettings(),
    listServices(undefined, true),
    listAreas(undefined, true),
    getPublishedPricing(),
    db()<{ id: string; author_name: string; body: string; context: string }[]>`
      select id, author_name, body, context from testimonials where published and permission_confirmed order by sort, created_at limit 6`,
  ]);
  const { business } = settings;
  const recurring = services.find((s) => s.slug === "recurring");
  const recurringPrices = recurring
    ? (["weekly", "biweekly", "monthly", "quarterly"] as Frequency[])
        .filter((f) => recurring.allowed_frequencies.includes(f) && pricing.rules.services.recurring?.frequencies[f])
        .map((f) => ({ f, cents: pricing.rules.services.recurring.frequencies[f]!.minimum_cents }))
    : [];

  return (
    <>
      {/* Hero */}
      <section className="on-dark relative overflow-hidden bg-obsidian text-ivory">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_80%_-10%,rgb(197_161_91/0.18),transparent_60%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pb-24 md:pt-20">
          <div>
            <p className="eyebrow">Las Vegas · Summerlin · Henderson</p>
            <h1 className="mt-4 text-[2.6rem] font-semibold leading-[1.05] text-ivory sm:text-6xl">
              Luxury home cleaning, <span className="gold-text">kept consistent.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/75 sm:text-lg">{business.description.split(". ")[0]}.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/quote" className="btn btn-primary btn-lg">
                Get My Quote
              </Link>
              <Link href="/quote?intent=book" className="btn btn-outline btn-lg">
                Book a Cleaning
              </Link>
            </div>
            <p className="mt-4 text-sm text-ivory/55">Instant estimate · Real calendar availability · Confirmed by our team</p>
          </div>
          <HeroArt />
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-ivory py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From quote to clean in four simple steps" />
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="card relative p-6">
                <span className="font-display text-5xl font-semibold text-champagne">{i + 1}</span>
                <s.icon className="absolute right-5 top-6 size-6 text-gold" aria-hidden />
                <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="scroll-mt-20 bg-cream/60 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Services" title="Care for every kind of clean" />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <article key={s.slug} className="card flex flex-col p-6 transition hover:shadow-[var(--shadow-lift)]">
                <Sparkles className="size-5 text-gold" aria-hidden />
                <h3 className="mt-3 text-2xl font-semibold">{s.name}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{s.short_description}</p>
                <div className="mt-5 flex gap-3">
                  <Link href={`/quote?service=${s.slug}`} className="btn btn-dark btn-sm">
                    Get a quote
                  </Link>
                  <Link href={`/services#${s.slug}`} className="btn btn-ghost btn-sm">
                    What&apos;s included
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Recurring */}
      {recurring && recurringPrices.length > 0 && (
        <section className="on-dark bg-midnight py-16 text-ivory sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 md:grid-cols-2 md:items-center">
            <div>
              <p className="eyebrow">Recurring cleaning</p>
              <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">Your home, at the same standard every visit</h2>
              <p className="mt-5 leading-relaxed text-ivory/75">{recurring.description}</p>
              <Link href="/quote?service=recurring" className="btn btn-primary mt-8">
                Price my recurring plan
              </Link>
            </div>
            <ul className="frame divide-y divide-gold/20 rounded-sm bg-obsidian/60 p-2">
              {recurringPrices.map(({ f, cents }) => (
                <li key={f} className="flex items-baseline justify-between gap-4 px-5 py-5">
                  <span className="font-display text-2xl">{FREQUENCY_LABELS[f]}</span>
                  <span className="text-right">
                    <span className="block text-xs uppercase tracking-[0.2em] text-champagne/70">Starting at</span>
                    <span className="gold-text font-display text-3xl font-semibold">{formatCents(cents)}</span>
                  </span>
                </li>
              ))}
              <li className="px-5 py-4 text-xs leading-relaxed text-ivory/60">
                Per visit, for a home of about 2 bedrooms and 2 bathrooms in maintained condition. Your estimate reflects your home&apos;s size, condition and any extras.
              </li>
            </ul>
          </div>
        </section>
      )}

      {/* Strengths */}
      {business.strengths.length > 0 && (
        <section className="bg-ivory py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Why Queen of Clean" title="Attention to detail, every visit" />
            <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {business.strengths.map((s) => (
                <div key={s.title} className="flex gap-4">
                  <Crown className="mt-1 h-5 w-7 shrink-0" />
                  <div>
                    <h3 className="text-xl font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {testimonials.length > 0 && (
        <section className="bg-cream/60 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Kind words" title="From our clients" />
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {testimonials.map((t) => (
                <figure key={t.id} className="card p-6">
                  <blockquote className="font-display text-xl leading-snug">&ldquo;{t.body}&rdquo;</blockquote>
                  <figcaption className="mt-4 text-sm font-semibold text-gold-ink">
                    {t.author_name}
                    {t.context && <span className="block font-normal text-muted">{t.context}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Areas */}
      <section id="areas" className="scroll-mt-20 bg-ivory py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Service area" title="Serving the Las Vegas Valley" />
          <ul className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-3">
            {areas.map((a) => (
              <li key={a.id} className="inline-flex items-center gap-2 rounded-full border border-gold/50 bg-[#fffdf8] px-4 py-2 text-sm font-semibold">
                <MapPin className="size-4 text-gold" aria-hidden />
                {a.name}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-6 max-w-xl text-center text-sm text-muted">
            We confirm every address by ZIP code when you request a quote. Outside these areas? Send a request anyway and we&apos;ll let you know.
          </p>
        </div>
      </section>

      {/* FAQ */}
      {business.faqs.length > 0 && (
        <section id="faq" className="scroll-mt-20 bg-cream/60 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHeading eyebrow="Questions" title="Frequently asked" />
            <div className="mt-10 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-[#fffdf8]">
              {business.faqs.map((f) => (
                <details key={f.q} className="group px-5 py-4 open:pb-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold">
                    {f.q}
                    <span aria-hidden className="text-xl text-gold transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Contact band */}
      <section className="on-dark bg-obsidian py-16 text-center text-ivory">
        <div className="mx-auto max-w-3xl px-4">
          <Crown className="mx-auto h-10 w-14" />
          <h2 className="mt-4 text-4xl font-semibold sm:text-5xl">A clean home is a happier home.</h2>
          <p className="mt-4 text-ivory/70">{business.response_time_text}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/quote" className="btn btn-primary btn-lg">Get My Quote</Link>
            <Link href="/contact" className="btn btn-outline btn-lg">Contact us</Link>
          </div>
          {(business.phone || business.email) && (
            <p className="mt-6 text-sm text-champagne/80">
              {business.phone && <a href={`tel:${business.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{business.phone}</a>}
              {business.phone && business.email && " · "}
              {business.email && <a href={`mailto:${business.email}`} className="hover:underline">{business.email}</a>}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mx-auto mt-3 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">{title}</h2>
      <div className="mx-auto mt-5 flex items-center justify-center gap-3" aria-hidden>
        <span className="h-px w-12 bg-gold/60" />
        <span className="size-1.5 rotate-45 bg-gold" />
        <span className="h-px w-12 bg-gold/60" />
      </div>
    </div>
  );
}
