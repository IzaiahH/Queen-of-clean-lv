import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/public/SectionHeading";
import { formatCents } from "@/lib/money";
import { lowestStartingPrice } from "@/lib/pricing/display";
import { getPublishedPricing, listAddons, listServices } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "House Cleaning Services in Las Vegas",
  description: "Recurring house cleaning, one-time cleaning, Queen Reset deep cleaning and move-in/move-out cleaning across Las Vegas, Henderson, Summerlin and North Las Vegas.",
  alternates: { canonical: "/services" },
};

export default async function ServicesPage() {
  const [services, addons, pricing] = await Promise.all([listServices(undefined, true), listAddons(undefined, true), getPublishedPricing()]);
  const pricedAddons = addons.filter((a) => pricing.rules.addons[a.slug]);
  return (
    <div className="bg-ivory">
      <section className="border-b border-line bg-paper px-4 py-14 sm:py-20">
        <SectionHeading as="h1" eyebrow="Our services" title="Home cleaning, tailored to your home" intro="Every service starts with a free online estimate. Extras are always optional and priced separately, and nothing is booked until our team confirms." />
      </section>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-14 sm:px-6 sm:py-20">
        {services.map((s) => {
          const from = lowestStartingPrice(pricing.rules, s.slug);
          return (
            <article key={s.slug} id={s.slug} className="card scroll-mt-28 p-6 sm:p-8">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-3xl font-semibold">{s.name}</h2>
                  <p className="mt-2 max-w-2xl leading-relaxed text-muted">{s.short_description}</p>
                  <p className="mt-3 text-sm font-semibold text-gold-ink">{from !== null ? `Starting at ${formatCents(from)}` : "Custom quote"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-3">
                  <Link href={`/quote?service=${s.slug}`} className="btn btn-dark btn-sm">Get a quote</Link>
                  <Link href={`/services/${s.slug}`} className="btn btn-ghost btn-sm">Details <ArrowRight className="size-4" aria-hidden /></Link>
                </div>
              </div>
            </article>
          );
        })}
        {pricedAddons.length > 0 && (
          <section className="card p-6 sm:p-8" aria-labelledby="extras">
            <h2 id="extras" className="text-3xl font-semibold">Optional extras</h2>
            <p className="mt-2 text-sm text-muted">Add any of these in the quote form; their prices appear line by line in your estimate.</p>
            <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              {pricedAddons.map((a) => {
                const r = pricing.rules.addons[a.slug];
                return (
                  <li key={a.slug} className="border-l-2 border-gold pl-4">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-semibold">
                      {a.name}
                      <span className="text-sm font-semibold text-gold-ink">
                        {r.starting_at ? "from " : ""}
                        {formatCents(r.price_cents)}
                        {r.unit === "each" && r.unit_label ? ` per ${r.unit_label}` : ""}
                      </span>
                    </p>
                    <p className="text-sm text-muted">{a.description}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
