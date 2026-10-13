import { useId } from "react";

/** Vector crown emblem recreated from the brand reference: five jeweled points, a center diamond and a jeweled band. */
export function Crown({ className, title }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 48" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-champagne)" />
          <stop offset="0.55" stopColor="var(--color-gold)" />
          <stop offset="1" stopColor="#9a7635" />
        </linearGradient>
      </defs>
      <path d="M8 36 L4 14 L13.5 25 L18 8 L25.5 22 L32 3 L38.5 22 L46 8 L50.5 25 L60 14 L56 36 Z" fill={`url(#g${id})`} />
      <path d="M8 36 L4 14 L13.5 25 L18 8 L25.5 22 L32 3 L38.5 22 L46 8 L50.5 25 L60 14 L56 36 Z" fill="none" stroke="#7a5c22" strokeOpacity="0.35" strokeWidth="0.8" />
      {[ [4, 13], [18, 7], [32, 2.5], [46, 7], [60, 13] ].map(([cx, cy]) => (
        <circle key={`${cx}`} cx={cx} cy={cy} r="2.6" fill={`url(#g${id})`} />
      ))}
      <path d="M32 21 L36 27 L32 33 L28 27 Z" fill="var(--color-ivory)" fillOpacity="0.9" stroke="#7a5c22" strokeOpacity="0.5" strokeWidth="0.6" />
      <rect x="7" y="36.5" width="50" height="7.5" rx="1.5" fill={`url(#g${id})`} />
      <rect x="7" y="36.5" width="50" height="7.5" rx="1.5" fill="none" stroke="#7a5c22" strokeOpacity="0.35" strokeWidth="0.8" />
      {[15, 23.5, 40.5, 49].map((cx) => (
        <circle key={cx} cx={cx} cy="40.25" r="1.5" fill="var(--color-espresso)" fillOpacity="0.55" />
      ))}
      <path d="M32 37.6 L34.4 40.25 L32 42.9 L29.6 40.25 Z" fill="var(--color-ivory)" fillOpacity="0.95" />
    </svg>
  );
}
