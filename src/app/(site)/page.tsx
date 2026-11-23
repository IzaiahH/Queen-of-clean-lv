import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroVisual } from "@/components/public/HeroVisual";
import { SectionHeading } from "@/components/public/SectionHeading";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { lowestStartingPrice, startingPrices } from "@/lib/pricing/display";
import { FREQUENCY_LABELS } from "@/lib/pricing/rules";
import { getPublishedPricing, listServices } from "@/lib/server/catalog";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Choose your service", body: "Recurring, one-time, a Queen Reset or a move clean." },
  { title: "Tell us about your home", body: "Bedrooms, bathrooms, size, pets and condition — a minute or two on your phone." },
  { title: "See your estimate", body: "A clear, line-by-line estimate from our current pricing. No phone tag." },
  { title: "Pick a time", body: "Choose from times that are actually open. We confirm every request personally." },
];

const RECURRING_BENEFITS = [
  "The same standard every visit, following your home's checklist",
  "Lower per-visit rates the more often we come",
  "A reserved spot on our calendar",
  "Your preferences and access notes saved for every visit",
];

export default async function HomePage() {
  const [settings, services, pricing, testimonials] = await Promise.all([
    getSettings(),
    listServices(undefined, true),
    getPublishedPricing(),
    db()<{ id: string; author_name: string; body: string; context: string }[]>`
      select id, author_name, body, context from testimonials where published and permission_confirmed order by sort, created_at limit 6`,
  ]);
  const { business } = settings;
  const listed = services.filter((s) => s.slug !== "custom");
  const recurring = services.find((s) => s.slug === "recurring");
  const plans = recurring
    ? (startingPrices(pricing.rules, "recurring") ?? []).filter((p) => recurring.allowed_frequencies.includes(p.frequency) && p.frequency !== "one_time")
    : [];

  return (
    <>
      {/* 1. Hero */}
      <section className="relative overflow-hidden bg-ivory">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(48rem_28rem_at_85%_0%,rgb(229_210_166/0.45),transparent_65%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-24 lg:pt-16">
          <div className="text-center lg:text-left">
            <div className="flex justify-center lg:hidden">
              <Logo variant="wordmark" height={150} name={business.name} priority />
            </div>
            <p className="eyebrow mt-8 lg:mt-0">Home cleaning across the Las Vegas Valley</p>
            <h1 className="mt-4 text-balance text-[2.55rem] font-semibold leading-[1.05] text-charcoal sm:text-6xl">{business.hero_headline}</h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">{business.hero_subtext}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link href="/quote" className="btn btn-primary btn-lg">Get My Free Quote</Link>
              <Link href="/services" className="btn btn-outline btn-lg">Explore Our Services</Link>
            </div>
            <p className="mt-5 text-sm text-muted">Free estimate in minutes · Real calendar availability · Confirmed by our team</p>
          </div>
          <HeroVisual imageUrl={business.hero_image_url} imageAlt={business.hero_image_alt} name={business.name} />
        </div>
      </section>

      {/* 2. Why choose */}
      {business.strengths.length > 0 && (
        <section className="section bg-paper">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Why Queen of Clean LV" title="Care you can see. Service you can count on." />
            <div className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2">
              {business.strengths.map((s) => (
                <div key={s.title} className="bg-paper p-7 sm:p-8">
                  <span aria-hidden className="block size-2 rotate-45 bg-gold" />
                  <h3 className="mt-4 text-2xl font-semibold">{s.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 3. Services */}
      <section id="services" className="section scroll-mt-24 bg-ivory">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="Our cleaning services" title="The right clean for every home" />
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            {listed.map((s) => {
              const from = lowestStartingPrice(pricing.rules, s.slug);
              return (
                <article key={s.slug} className="card group flex flex-col p-7 transition hover:shadow-[var(--shadow-lift)]">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <h3 className="text-[1.7rem] font-semibold leading-tight">{s.name}</h3>
                    {from !== null && (
                      <p className="shrink-0 text-sm text-muted sm:text-right">
                        from <span className="font-display text-2xl font-semibold text-gold-dark">{formatCents(from)}</span>
                      </p>
                    )}
                  </div>
                  <div className="mt-4 h-px w-12 bg-gold/70" />
                  <p className="mt-4 flex-1 leading-relaxed text-muted">{s.short_description}</p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link href={`/quote?service=${s.slug}`} className="btn btn-dark btn-sm">Get a quote</Link>
                    <Link href={`/services/${s.slug}`} className="btn btn-ghost btn-sm">
                      Learn more <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-6 text-center text-sm text-muted">Starting prices are for smaller homes in maintained condition. Your estimate reflects your home&apos;s size, condition and any extras.</p>
        </div>
      </section>

      {/* 4. How it works */}
      <section id="how-it-works" className="section scroll-mt-24 bg-paper">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading eyebrow="How it works" title="From quote to clean in four simple steps" />
          <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative text-center">
                <span className="mx-auto flex size-14 items-center justify-center rounded-full border border-gold font-display text-2xl font-semibold text-gold-dark">{i + 1}</span>
                <h3 className="mt-5 text-xl font-semibold">{s.title}</h3>
                <p className="mx-auto mt-2 max-w-[16rem] text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 text-center">
            <Link href="/quote" className="btn btn-primary btn-lg">Start My Free Quote</Link>
          </div>
        </div>
      </section>

      {/* 5. Recurring plans */}
      {plans.length > 0 && (
        <section id="plans" className="section scroll-mt-24 bg-cream/70">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Recurring cleaning plans" title="Your home, at the same standard every visit" />
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {plans.map((p) => (
                <div key={p.frequency} className="card flex flex-col items-center p-8 text-center">
                  <p className="eyebrow">{FREQUENCY_LABELS[p.frequency]}</p>
                  <p className="mt-4 text-sm text-muted">Starting at</p>
                  <p className="font-display text-5xl font-semibold text-charcoal">{formatCents(p.cents)}</p>
                  <p className="mt-1 text-sm text-muted">per visit</p>
                  <Link href={`/quote?service=recurring&frequency=${p.frequency}`} className="btn btn-outline mt-6 w-full">
                    Price my {FREQUENCY_LABELS[p.frequency].toLowerCase()} plan
                  </Link>
                </div>
              ))}
            </div>
            <ul className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
              {RECURRING_BENEFITS.map((b) => (
                <li key={b} className="flex gap-3 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rotate-45 bg-gold" />
                  {b}
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-muted">
              Starting prices are for a home of about 2 bedrooms and 2 bathrooms in maintained condition. Larger homes, pets and extras are reflected in your estimate.
            </p>
          </div>
        </section>
      )}

      {/* 6. What makes us different */}
      {business.differentiators.length > 0 && (
        <section className="section on-dark bg-obsidian text-ivory">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="What makes us different" title="Details, done deliberately" dark />
            <div className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
              {business.differentiators.map((d) => (
                <div key={d.title} className="border-l border-gold/50 pl-6">
                  <h3 className="text-2xl font-semibold text-champagne">{d.title}</h3>
                  <p className="mt-2 leading-relaxed text-ivory/70">{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 7. Customer reviews — only real, permission-confirmed testimonials entered in Admin → Settings */}
      {testimonials.length > 0 && (
        <section className="section bg-paper">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="Customer reviews" title="From our clients" />
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {testimonials.map((t) => (
                <figure key={t.id} className="card flex flex-col p-7">
                  <span aria-hidden className="font-display text-5xl leading-none text-gold">&ldquo;</span>
                  <blockquote className="mt-1 flex-1 font-display text-xl leading-snug">{t.body}</blockquote>
                  <figcaption className="mt-5 text-sm font-semibold text-gold-ink">
                    {t.author_name}
                    {t.context && <span className="block font-normal text-muted">{t.context}</span>}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 8. Service area */}
      <section id="areas" className="section scroll-mt-24 bg-ivory">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <SectionHeading eyebrow="Las Vegas service area" title="Serving homes across the valley" />
          <ul className="mx-auto mt-12 flex flex-wrap justify-center gap-2.5">
            {business.communities.map((c) => (
              <li key={c} className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-paper px-4 py-2 text-sm font-semibold">
                <MapPin className="size-3.5 text-gold-dark" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
          <p className="mx-auto mt-8 max-w-xl text-center text-sm leading-relaxed text-muted">
            We check every address by ZIP code when you request a quote. Not sure if you&apos;re in our area? Send a request anyway and we&apos;ll let you know.
          </p>
        </div>
      </section>

      {/* 9. FAQ */}
      {business.faqs.length > 0 && (
        <section id="faq" className="section scroll-mt-24 bg-paper">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
            <div className="mt-12 divide-y divide-line border-y border-line">
              {business.faqs.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-left text-lg font-semibold">
                    {f.q}
                    <span aria-hidden className="text-2xl font-light text-gold-dark transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 10. Final booking CTA */}
      <section className="section bg-ivory">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="frame bg-paper px-6 py-14 text-center sm:px-12">
            <Logo variant="emblem" height={72} name={business.name} className="mx-auto" />
            <h2 className="mt-6 text-4xl font-semibold sm:text-5xl">Ready for a cleaner home?</h2>
            <p className="mx-auto mt-4 max-w-lg text-muted">Get your free estimate in a couple of minutes. {business.response_time_text}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/quote" className="btn btn-primary btn-lg">Get My Free Quote</Link>
              <Link href="/contact" className="btn btn-outline btn-lg">Ask a question</Link>
            </div>
            {(business.phone || business.email) && (
              <p className="mt-6 text-sm text-gold-ink">
                {business.phone && <a href={`tel:${business.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{business.phone}</a>}
                {business.phone && business.email && " · "}
                {business.email && <a href={`mailto:${business.email}`} className="hover:underline">{business.email}</a>}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
