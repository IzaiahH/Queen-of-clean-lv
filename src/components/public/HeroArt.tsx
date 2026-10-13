import { Crown } from "@/components/brand/Crown";

/** Decorative arch composition (no stock photography): fine gold line work framing the crown. */
export function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-[15rem] sm:max-w-sm" aria-hidden>
      <svg viewBox="0 0 320 400" className="w-full">
        <defs>
          <linearGradient id="hero-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-champagne)" />
            <stop offset="1" stopColor="var(--color-gold)" />
          </linearGradient>
        </defs>
        <path d="M20 390 V160 A140 140 0 0 1 300 160 V390 Z" fill="var(--color-midnight)" stroke="url(#hero-g)" strokeWidth="1.5" />
        <path d="M36 380 V164 A124 124 0 0 1 284 164 V380 Z" fill="none" stroke="var(--color-gold)" strokeOpacity="0.45" strokeWidth="1" />
        <line x1="20" y1="390" x2="300" y2="390" stroke="url(#hero-g)" strokeWidth="1.5" />
        {[
          [70, 120, 7],
          [250, 140, 5],
          [268, 352, 7],
          [56, 350, 5],
        ].map(([x, y, r], i) => (
          <path key={i} d={`M${x} ${y - r} L${x + r * 0.35} ${y - r * 0.35} L${x + r} ${y} L${x + r * 0.35} ${y + r * 0.35} L${x} ${y + r} L${x - r * 0.35} ${y + r * 0.35} L${x - r} ${y} L${x - r * 0.35} ${y - r * 0.35} Z`} fill="var(--color-champagne)" opacity="0.85" />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-12 pt-16 text-center">
        <Crown className="h-16 w-20 drop-shadow-[0_6px_18px_rgba(197,161,91,0.35)]" />
        <p className="gold-text mt-4 font-display text-[2rem] font-semibold leading-none tracking-[0.06em]">
          QUEEN <span className="text-xl italic">of</span>
          <br />
          CLEAN LV
        </p>
        <div className="mt-4 h-px w-24 bg-gradient-to-r from-transparent via-gold to-transparent" />
        <p className="mt-4 text-[0.62rem] font-bold uppercase tracking-[0.3em] text-champagne/80">Professional · Reliable · Thorough</p>
      </div>
    </div>
  );
}
