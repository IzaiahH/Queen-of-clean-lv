import { PageHeader } from "@/components/admin/AdminShell";
import { NewQuoteForm } from "@/components/admin/NewQuoteForm";
import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPublishedPricing, listAddons, listServices } from "@/lib/server/catalog";

export const metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requirePage("quotes.edit");
  const sp = await searchParams;
  const [services, addons, pricing] = await Promise.all([listServices(db(), true), listAddons(db(), true), getPublishedPricing()]);
  let initial = null;
  if (sp.customer && /^[0-9a-f-]{36}$/i.test(sp.customer)) {
    const [c] = await db()<{ id: string; full_name: string; email: string | null }[]>`select id, full_name, email from customers where id = ${sp.customer}`;
    if (c) {
      const props = await db()<{ id: string; label: string; address: string; has_address: boolean }[]>`select id, label, concat_ws(', ', address_line1, city) as address, address_line1 is not null as has_address from properties where customer_id = ${c.id} order by is_primary desc`;
      initial = { ...c, properties: Array.from(props).map((p) => ({ ...p })) };
    }
  }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Sales" title="New quote" />
      <NewQuoteForm initialCustomer={initial}
        services={services.map((s) => ({ slug: s.slug, name: s.name, allowed_frequencies: s.allowed_frequencies }))}
        addons={addons.map((a) => ({ slug: a.slug, name: a.name, max_quantity: pricing.rules.addons[a.slug]?.max_quantity ?? 1, unit_label: pricing.rules.addons[a.slug]?.unit_label ?? "" }))} />
    </div>
  );
}
