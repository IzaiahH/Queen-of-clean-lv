import { QuoteWizard, type WizardCatalog } from "@/components/public/QuoteWizard";
import { getPublishedPricing, listAddons, listServices } from "@/lib/server/catalog";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get your quote", description: "Get an instant cleaning estimate and request an appointment online." };

export default async function QuotePage({ searchParams }: { searchParams: Promise<{ service?: string; intent?: string }> }) {
  const sp = await searchParams;
  const [services, addons, pricing, settings] = await Promise.all([listServices(undefined, true), listAddons(undefined, true), getPublishedPricing(), getSettings()]);
  const catalog: WizardCatalog = {
    services: services
      .filter((s) => pricing.rules.services[s.slug])
      .map((s) => ({ slug: s.slug, name: s.name, short: s.short_description, frequencies: s.allowed_frequencies.filter((f) => pricing.rules.services[s.slug].frequencies[f]), kind: s.kind })),
    // Customer-facing add-on prices only (these are shown on the public site anyway).
    addons: addons
      .filter((a) => pricing.rules.addons[a.slug])
      .map((a) => {
        const r = pricing.rules.addons[a.slug];
        return { slug: a.slug, name: a.name, description: a.description, price_cents: r.price_cents, unit: r.unit, unit_label: r.unit_label, max_quantity: r.max_quantity, applies_to: r.applies_to, starting_at: r.starting_at };
      }),
    policies: { cancellation: settings.policies.cancellation_policy, reschedule: settings.policies.reschedule_policy },
    responseTime: settings.business.response_time_text,
    businessName: settings.business.name,
  };
  return (
    <div className="bg-ivory">
      <div className="on-dark bg-obsidian px-4 pb-10 pt-8 text-center text-ivory sm:pb-14 sm:pt-12">
        <p className="eyebrow">Instant estimate</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-5xl">Get your cleaning quote</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-ivory/70">About two minutes. Nothing is booked until our team confirms.</p>
      </div>
      <QuoteWizard catalog={catalog} initialService={sp.service ?? null} />
    </div>
  );
}
