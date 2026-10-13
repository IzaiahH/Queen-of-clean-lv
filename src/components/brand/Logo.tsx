import { Crown } from "./Crown";

type Props = { variant?: "horizontal" | "stacked"; tone?: "dark" | "light"; showTagline?: boolean; className?: string; name?: string; imageSrc?: string | null };

/**
 * Typographic recreation of the Queen of Clean LV logo: crown emblem with an engraved-style serif
 * wordmark ("of" set smaller, as in the original). `tone` is the background it sits on.
 */
export function Logo({ variant = "horizontal", tone = "dark", showTagline = false, className = "", name = "Queen of Clean LV", imageSrc = null }: Props) {
  // An owner-uploaded logo (Settings → Business) replaces the typographic version.
  // eslint-disable-next-line @next/next/no-img-element
  if (imageSrc) return <img src={imageSrc} alt={name} className={`${variant === "stacked" ? "h-24" : "h-11"} w-auto object-contain ${className}`} />;
  const ink = tone === "dark" ? "gold-text" : "text-gold-ink";
  const sub = tone === "dark" ? "text-champagne/80" : "text-muted";
  const match = name.match(/^(.*?)\s+(of)\s+(.*)$/i);
  const word = match ? (
    <>
      {match[1].toUpperCase()} <span className="text-[0.62em] tracking-[0.08em] align-[0.12em] normal-case italic">of</span> {match[3].toUpperCase()}
    </>
  ) : (
    name.toUpperCase()
  );
  if (variant === "stacked") {
    return (
      <span className={`inline-flex flex-col items-center text-center ${className}`} aria-label={name}>
        <Crown className="h-12 w-16" />
        <span className={`mt-2 font-display text-3xl font-semibold tracking-[0.06em] ${ink}`} aria-hidden>
          {word}
        </span>
        {showTagline && <span className={`mt-1 text-[0.65rem] font-bold uppercase tracking-[0.28em] ${sub}`}>Luxury Home Cleaning Services</span>}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`} aria-label={name}>
      <Crown className="h-8 w-11 shrink-0" />
      <span className="flex flex-col leading-none" aria-hidden>
        <span className={`font-display text-[1.3rem] font-semibold tracking-[0.05em] sm:text-[1.45rem] ${ink}`}>{word}</span>
        {showTagline && <span className={`mt-1 text-[0.58rem] font-bold uppercase tracking-[0.26em] ${sub}`}>Luxury Home Cleaning</span>}
      </span>
    </span>
  );
}
