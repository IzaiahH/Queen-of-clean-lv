import Link from "next/link";
import { PageHeader } from "@/components/admin/AdminShell";
import { AddonsEditor, AreasEditor, ServicesEditor } from "@/components/admin/CatalogEditors";
import { PricingEditor } from "@/components/admin/PricingEditor";
import { StartDraftButton } from "@/components/admin/StartDraftButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { lintRules } from "@/lib/pricing/rules";
import { getDraftPricing, getPublishedPricing, listAddons, listAreas, listServices } from "@/lib/server/catalog";
import { listVersions } from "@/lib/server/pricing-admin";
import { getSettings } from "@/lib/server/settings";
import { formatDateTime } from "@/lib/time";

export const metadata = { title: "Pricing & Services" };
const TABS = [["prices", "Prices"], ["services", "Services"], ["addons", "Add-ons"], ["areas", "Service areas"], ["history", "History"]] as const;

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage("pricing.edit");
  const tab = (await searchParams).tab ?? "prices";
  const [published, draft, services, addons, areas, settings] = await Promise.all([getPublishedPricing(), getDraftPricing(), listServices(db()), listAddons(db()), listAreas(db()), getSettings()]);
  const tz = settings.booking.timezone;
  const names = { services: services.map((s) => ({ slug: s.slug, name: s.name, active: s.active })), addons: addons.map((a) => ({ slug: a.slug, name: a.name, active: a.active })) };
  const addonPrice = (slug: string) => {
    const a = published.rules.addons[slug];
    if (!a) return null;
    return `${a.starting_at ? "from " : ""}${formatCents(a.price_cents)}${a.unit === "each" ? ` per ${a.unit_label || "unit"}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Business" title="Pricing & Services">
        <p className="mt-1 text-sm text-muted">Live prices: version {published.version}{published.published_at ? `, published ${formatDateTime(published.published_at, tz)}` : ""}.</p>
      </PageHeader>
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Pricing sections">
        {TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold ${tab === k ? "border-obsidian bg-obsidian text-champagne" : "border-line bg-white hover:border-gold"}`}>{l}</Link>)}
      </nav>

      {tab === "prices" && (draft ? (
        <PricingEditor key={draft.id} initial={draft.rules} initialNotes={draft.notes} names={names} draftVersion={draft.version} publishedVersion={published.version}
          initialWarnings={lintRules(draft.rules, addons.filter((a) => a.active).map((a) => a.slug))} />
      ) : (
        <div className="card space-y-4 p-6">
          <p>Prices are changed in a draft so you can test them before customers see them. Publishing creates a new version; existing quotes keep the price they were given.</p>
          {lintRules(published.rules, addons.filter((a) => a.active).map((a) => a.slug)).length > 0 && <p className="text-sm text-status-pending">The live prices have warnings. Start a draft to review them.</p>}
          <StartDraftButton />
          <p className="text-xs text-muted">The starting prices are a draft set up for you (weekly $165, every 2 weeks $185, monthly $210, Queen Reset deep clean $275). Review them before relying on online booking.</p>
        </div>
      ))}
      {tab === "services" && <ServicesEditor services={services.map((s) => ({ ...s, includes: [...s.includes], excludes: [...s.excludes], allowed_frequencies: [...s.allowed_frequencies], priced: Boolean(published.rules.services[s.slug]) }))} />}
      {tab === "addons" && <AddonsEditor addons={addons.map((a) => ({ ...a, price: addonPrice(a.slug) }))} />}
      {tab === "areas" && (
        <>
          <p className="text-sm text-muted">{settings.booking.allow_unknown_areas ? "Addresses outside these areas can still request service and are flagged for review (change in Settings → Booking)." : "Addresses outside these areas can't book online (change in Settings → Booking)."}</p>
          <AreasEditor areas={areas.map((a) => ({ ...a, zip_codes: [...a.zip_codes] }))} />
        </>
      )}
      {tab === "history" && (
        <div className="card overflow-x-auto"><table className="table"><thead><tr><th>Version</th><th>Status</th><th>Published</th><th>Quotes priced</th><th>Notes</th></tr></thead><tbody>
          {(await listVersions()).map((v) => <tr key={v.id}><td className="font-semibold">v{v.version}</td><td><StatusBadge status={v.status === "published" ? "active" : v.status === "draft" ? "draft" : "archived"} label={v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Archived"} /></td><td className="text-sm">{v.published_at ? `${formatDateTime(v.published_at, tz)}${v.published_by_name ? ` by ${v.published_by_name}` : ""}` : "—"}</td><td>{v.quotes}</td><td className="max-w-md text-sm">{v.notes || "—"}</td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}
