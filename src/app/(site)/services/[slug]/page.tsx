import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, X } from "lucide-react";
import { cache } from "react";
import { SectionHeading } from "@/components/public/SectionHeading";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { startingPrices } from "@/lib/pricing/display";
import { FREQUENCY_LABELS } from "@/lib/pricing/rules";
import { getPublishedPricing, listAddons, type ServiceRow } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** Only active services have public pages; future services (Airbnb, commercial) stay hidden until enabled in Admin. */
const activeService = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const [row] = await db()<ServiceRow[]>`select * from services where slug = ${slug} and active`;
  return row ?? null;
});

const SEO_TITLES: Record<string, string> = {
  recurring: "Recurring House Cleaning in Las Vegas",
  standard: "One-Time House Cleaning in Las Vegas",
  deep: "Deep Cleaning in Las Vegas — Queen Reset",
  move: "Move-In & Move-Out Cleaning in Las Vegas",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const s = await activeService(slug);
  if (!s) return { title: "Service not found", robots: { index: false } };
  return {
    title: SEO_TITLES[s.slug] ?? s.name,
    description: `${s.short_description} Serving Las Vegas, Henderson, Summerlin and North Las Vegas. Get a free estimate online.`.slice(0, 300),
    alternates: { canonical: `/services/${s.slug}` },
  };
}

export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const service = await activeService(slug);
  if (!service) notFound();
  const [pricing, addons] = await Promise.all([getPublishedPricing(), listAddons(undefined, true)]);
  const prices = (startingPrices(pricing.rules, service.slug) ?? []).filter((p) => service.allowed_frequencies.includes(p.frequency));
  const isRecurring = service.kind === "recurring";
  const extras = addons.filter((a) => {
    const r = pricing.rules.addons[a.slug];
    return r && (r.applies_to.includes("*") || r.applies_to.includes(service.slug));
  });
  const paragraphs = service.description.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const quoteHref = `/quote?service=${service.slug}`;

  return (
    <div className="bg-ivory">
      <section className="border-b border-line bg-paper px-4 py-14 sm:py-20">
        <nav aria-label="Breadcrumb" className="mb-6 text-center text-sm text-muted">
          <Link href="/services" className="hover:text-gold-ink">Services</Link> <span aria-hidden>/</span> <span>{service.name}</span>
        </nav>
        <SectionHeading as="h1" eyebrow={isRecurring ? "Weekly · Every 2 weeks · Monthly" : "Las Vegas Valley"} title={service.name} intro={service.short_description} />
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={quoteHref} className="btn btn-primary btn-lg">Get My Free Quote</Link>
          <Link href="/services" className="btn btn-outline btn-lg">All services</Link>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-10">
          <div className="space-y-4 text-lg leading-relaxed text-charcoal/90">
            {paragraphs.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>

          {isRecurring && prices.length > 0 && (
            <section aria-labelledby="freq" className="card p-6 sm:p-8">
              <h2 id="freq" className="text-3xl font-semibold">How frequency affects your price</h2>
              <p className="mt-2 text-muted">The more often we visit, the less catch-up work each visit needs, so per-visit rates go down. One-time cleanings don&apos;t receive recurring rates.</p>
              <ul className="mt-6 divide-y divide-line border-y border-line">
                {prices.map((p) => (
                  <li key={p.frequency} className="flex items-center justify-between gap-4 py-4">
                    <span className="font-display text-2xl">{FREQUENCY_LABELS[p.frequency]}</span>
                    <span className="text-right">
                      <span className="block text-xs uppercase tracking-[0.18em] text-muted">Starting at</span>
                      <span className="font-display text-3xl font-semibold text-gold-dark">{formatCents(p.cents)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-relaxed text-muted">Per visit, for a home of about 2 bedrooms and 2 bathrooms in maintained condition. Your estimate reflects your home&apos;s size, condition, pets and extras.</p>
            </section>
          )}

          {(service.includes.length > 0 || service.excludes.length > 0) && (
            <section aria-labelledby="scope" className="grid gap-8 sm:grid-cols-2">
              <h2 id="scope" className="sr-only">What&apos;s included</h2>
              {service.includes.length > 0 && (
                <div>
                  <p className="eyebrow">Typically included</p>
                  <ul className="mt-4 space-y-2.5">
                    {service.includes.map((i) => (
                      <li key={i} className="flex gap-2.5 text-sm leading-relaxed"><Check className="mt-0.5 size-4 shrink-0 text-gold-dark" aria-hidden />{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              {service.excludes.length > 0 && (
                <div>
                  <p className="eyebrow">Not included</p>
                  <ul className="mt-4 space-y-2.5 text-muted">
                    {service.excludes.map((i) => (
                      <li key={i} className="flex gap-2.5 text-sm leading-relaxed"><X className="mt-0.5 size-4 shrink-0" aria-hidden />{i}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted sm:col-span-2">The exact scope of your visit is confirmed with you before your appointment.</p>
            </section>
          )}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-32 lg:self-start">
          <div className="frame bg-paper p-7 text-center">
            <p className="eyebrow">Your estimate</p>
            {prices.length > 0 ? (
              <>
                <p className="mt-3 text-sm text-muted">Starting at</p>
                <p className="font-display text-5xl font-semibold">{formatCents(Math.min(...prices.map((p) => p.cents)))}</p>
                <p className="mt-2 text-sm text-muted">{service.requires_review ? "Reviewed by our team before we confirm a price." : "See your exact estimate in about two minutes."}</p>
              </>
            ) : (
              <p className="mt-3 text-muted">Priced individually. Tell us about the job and we&apos;ll send a custom quote.</p>
            )}
            <Link href={quoteHref} className="btn btn-primary btn-lg mt-6 w-full">Get My Free Quote</Link>
          </div>
          {extras.length > 0 && (
            <div className="card p-6">
              <p className="eyebrow">Optional extras</p>
              <ul className="mt-4 space-y-2 text-sm">
                {extras.map((a) => {
                  const r = pricing.rules.addons[a.slug];
                  return (
                    <li key={a.slug} className="flex justify-between gap-3">
                      <span>{a.name}</span>
                      <span className="shrink-0 font-semibold text-gold-ink">
                        {r.starting_at ? "from " : ""}
                        {formatCents(r.price_cents)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
