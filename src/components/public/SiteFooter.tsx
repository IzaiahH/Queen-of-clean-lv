import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

type Props = {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  hours: string;
  logo?: string | null;
  services: { slug: string; name: string }[];
  social: { label: string; url: string }[];
};

/** Contact details only appear once the owner enters them in Settings → Business; nothing is invented. */
export function SiteFooter({ name, tagline, phone, email, hours, logo = null, services, social }: Props) {
  return (
    <footer className="on-dark bg-obsidian text-ivory/80">
      <div className="gold-rule" />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Logo variant="wordmark" height={130} name={name} imageSrc={logo} />
          <p className="mt-5 max-w-xs font-display text-lg italic text-champagne/90">{tagline}</p>
          <p className="mt-2 text-sm text-ivory/60">Residential cleaning throughout the Las Vegas Valley.</p>
        </div>
        <div>
          <p className="eyebrow">Services</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {services.map((s) => (
              <li key={s.slug}>
                <Link className="hover:text-champagne" href={`/services/${s.slug}`}>{s.name}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Company</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link className="hover:text-champagne" href="/quote">Get a free quote</Link></li>
            <li><Link className="hover:text-champagne" href="/#areas">Service area</Link></li>
            <li><Link className="hover:text-champagne" href="/#faq">FAQ</Link></li>
            <li><Link className="hover:text-champagne" href="/privacy">Privacy policy</Link></li>
            <li><Link className="hover:text-champagne" href="/terms">Terms of service</Link></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow">Contact</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {phone ? <li><a className="hover:text-champagne" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></li> : null}
            {email ? <li><a className="break-all hover:text-champagne" href={`mailto:${email}`}>{email}</a></li> : null}
            {hours ? <li className="text-ivory/60">{hours}</li> : null}
            <li><Link className="hover:text-champagne" href="/contact">Send us a message</Link></li>
          </ul>
          {social.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {social.map((s) => (
                <li key={s.url}>
                  <a className="text-champagne/90 hover:text-champagne" href={s.url} rel="noopener noreferrer" target="_blank">{s.label}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="border-t border-gold/15 px-4 py-6 text-center text-xs text-ivory/50">
        © {new Date().getFullYear()} {name} · Las Vegas, Nevada
      </div>
    </footer>
  );
}
