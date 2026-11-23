import Image from "next/image";

/**
 * The owner's supplied logo artwork (public/images). Never redrawn as text.
 *  - "wordmark": the full Queen of Clean LV logo (crown, wordmark and tagline). Header (desktop), hero, footer, login.
 *  - "emblem":   the standalone crowned Q. Mobile header, admin, favicon-scale branding.
 *  - "admin":    emblem plus a small "Admin" label for the back office.
 * Both files have transparent backgrounds, so they sit cleanly on ivory, white or charcoal.
 * An owner-uploaded logo (Settings → Business) replaces the wordmark where `imageSrc` is passed.
 */
export const WORDMARK = { src: "/images/queen-of-clean-logo.png", width: 1304, height: 922 } as const;
export const EMBLEM = { src: "/images/queen-crowned-q.png", width: 857, height: 1055 } as const;

type Props = {
  variant?: "wordmark" | "emblem" | "admin";
  /** Rendered height in px; width follows the artwork's proportions. */
  height?: number;
  className?: string;
  name?: string;
  imageSrc?: string | null;
  priority?: boolean;
};

export function Logo({ variant = "admin", height, className = "", name = "Queen of Clean LV", imageSrc = null, priority = false }: Props) {
  if (variant === "wordmark") {
    const h = height ?? 96;
    if (imageSrc) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={imageSrc} alt={name} style={{ height: h }} className={`w-auto object-contain ${className}`} />;
    }
    return (
      <Image
        src={WORDMARK.src}
        width={Math.round((h * WORDMARK.width) / WORDMARK.height)}
        height={h}
        alt={`${name} — Crowned in Cleanliness. Trusted in Care.`}
        priority={priority}
        className={`h-auto max-w-full ${className}`}
        style={{ height: h, width: "auto" }}
        sizes={`${Math.round((h * WORDMARK.width) / WORDMARK.height)}px`}
      />
    );
  }
  const h = height ?? (variant === "admin" ? 40 : 44);
  const emblem = (
    <Image
      src={EMBLEM.src}
      width={Math.round((h * EMBLEM.width) / EMBLEM.height)}
      height={h}
      alt={variant === "emblem" ? name : ""}
      priority={priority}
      className={variant === "emblem" ? className : "shrink-0"}
      style={{ height: h, width: "auto" }}
      sizes={`${Math.round((h * EMBLEM.width) / EMBLEM.height)}px`}
    />
  );
  if (variant === "emblem") return emblem;
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      {emblem}
      <span className="flex flex-col leading-tight">
        <span className="font-display text-lg font-semibold tracking-wide text-champagne">{name}</span>
        <span className="text-[0.62rem] font-bold uppercase tracking-[0.24em] text-ivory/55">Admin</span>
      </span>
    </span>
  );
}
