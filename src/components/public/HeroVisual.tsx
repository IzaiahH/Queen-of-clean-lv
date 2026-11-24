import { Logo } from "@/components/brand/Logo";

/**
 * Hero image. Shows the owner's photograph when one is set in Settings → Business (an https URL or a
 * file placed in /public). Until then it presents the full logo in a framed panel — never stock imagery
 * passed off as the company's own work.
 */
export function HeroVisual({ imageUrl, imageAlt, name }: { imageUrl: string; imageAlt: string; name: string }) {
  if (imageUrl) {
    return (
      <div className="relative">
        <div aria-hidden className="absolute -inset-3 hidden rounded-[var(--radius-card)] border border-gold/40 sm:block" />
        {/* eslint-disable-next-line @next/next/no-img-element -- owner-configured URL; host isn't known at build time */}
        <img
          src={imageUrl}
          alt={imageAlt || "A freshly cleaned Las Vegas home"}
          className="relative aspect-[4/5] w-full rounded-[var(--radius-card)] object-cover shadow-[var(--shadow-lift)] sm:aspect-[5/4] lg:aspect-[4/5]"
          fetchPriority="high"
        />
      </div>
    );
  }
  return (
    <div className="frame mx-auto hidden w-full max-w-md bg-paper px-10 py-14 shadow-[var(--shadow-soft)] lg:block">
      <Logo variant="wordmark" height={300} name={name} priority className="mx-auto" />
    </div>
  );
}
