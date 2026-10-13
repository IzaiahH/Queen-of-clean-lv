import Link from "next/link";
import { Check, X } from "lucide-react";
import { listAddons, listServices } from "@/lib/server/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Services" };

export default async function ServicesPage() {
  const [services, addons] = await Promise.all([listServices(undefined, true), listAddons(undefined, true)]);
  return (
    <div className="bg-ivory">
      <section className="on-dark bg-obsidian py-14 text-center text-ivory sm:py-20">
        <p className="eyebrow">Services</p>
        <h1 className="mx-auto mt-3 max-w-2xl px-4 text-4xl font-semibold sm:text-6xl">What every clean includes</h1>
        <p className="mx-auto mt-4 max-w-xl px-4 text-ivory/70">Clear scopes, so you know exactly what you&apos;re booking. Extras are always optional and priced separately.</p>
      </section>
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-14 sm:px-6">
        {services.map((s) => (
          <article id={s.slug} key={s.slug} className="card scroll-mt-24 p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-3xl font-semibold">{s.name}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{s.description}</p>
              </div>
              <Link href={`/quote?service=${s.slug}`} className="btn btn-primary shrink-0">Get a quote</Link>
            </div>
            {(s.includes.length > 0 || s.excludes.length > 0) && (
              <div className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
                {s.includes.length > 0 && (
                  <div>
                    <p className="eyebrow">Included</p>
                    <ul className="mt-3 space-y-2 text-sm">
                      {s.includes.map((i) => (
                        <li key={i} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{i}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.excludes.length > 0 && (
                  <div>
                    <p className="eyebrow">Not included</p>
                    <ul className="mt-3 space-y-2 text-sm text-muted">
                      {s.excludes.map((i) => (
                        <li key={i} className="flex gap-2"><X className="mt-0.5 size-4 shrink-0" aria-hidden />{i}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </article>
        ))}
        {addons.length > 0 && (
          <section className="card p-6 sm:p-8">
            <h2 className="text-3xl font-semibold">Optional extras</h2>
            <p className="mt-2 text-sm text-muted">Add these in the quote form. Prices are shown in your estimate.</p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {addons.map((a) => (
                <li key={a.slug} className="border-l-2 border-gold pl-3">
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-sm text-muted">{a.description}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
