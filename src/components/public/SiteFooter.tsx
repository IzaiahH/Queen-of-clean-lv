import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export function SiteFooter({ name, tagline, phone, email, hours, logo = null }: { name: string; tagline: string; phone: string; email: string; hours: string; logo?: string | null }) {
  return (
    <footer className="on-dark bg-obsidian text-ivory/80">
      <div className="gold-rule" />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo name={name} showTagline imageSrc={logo} />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ivory/70">{tagline || "Residential cleaning for Las Vegas homes."}</p>
        </div>
        <div>
          <p className="eyebrow">Contact</p>
          <ul className="mt-3 space-y-2 text-sm">
            {phone ? <li><a className="hover:text-champagne" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></li> : null}
            {email ? <li><a className="hover:text-champagne" href={`mailto:${email}`}>{email}</a></li> : null}
            {hours ? <li>{hours}</li> : null}
            <li><Link className="hover:text-champagne" href="/contact">Send us a message</Link></li>
          </ul>
        </div>
        <div>
          <p className="eyebrow">Explore</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:text-champagne" href="/quote">Get a quote</Link></li>
            <li><Link className="hover:text-champagne" href="/services">Services</Link></li>
            <li><Link className="hover:text-champagne" href="/privacy">Privacy policy</Link></li>
            <li><Link className="hover:text-champagne" href="/terms">Terms of service</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gold/15 py-5 text-center text-xs tracking-[0.2em] text-ivory/50 uppercase">
        Professional · Reliable · Thorough
        <span className="mt-2 block normal-case tracking-normal">© {new Date().getFullYear()} {name}. Las Vegas, Nevada.</span>
      </div>
    </footer>
  );
}
