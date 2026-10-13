import { ContactForm } from "@/components/public/ContactForm";
import { getSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact" };

export default async function ContactPage() {
  const { business } = await getSettings();
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1fr_1.4fr]">
      <div>
        <p className="eyebrow">Contact</p>
        <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Let&apos;s talk about your home</h1>
        <p className="mt-4 text-muted">{business.response_time_text}</p>
        <dl className="mt-8 space-y-4 text-sm">
          {business.phone && (<div><dt className="eyebrow">Phone</dt><dd className="mt-1 text-base"><a className="hover:text-gold-ink" href={`tel:${business.phone.replace(/[^\d+]/g, "")}`}>{business.phone}</a></dd></div>)}
          {business.email && (<div><dt className="eyebrow">Email</dt><dd className="mt-1 text-base"><a className="hover:text-gold-ink" href={`mailto:${business.email}`}>{business.email}</a></dd></div>)}
          {business.hours_text && (<div><dt className="eyebrow">Hours</dt><dd className="mt-1 text-base">{business.hours_text}</dd></div>)}
        </dl>
      </div>
      <div className="relative"><ContactForm /></div>
    </div>
  );
}
