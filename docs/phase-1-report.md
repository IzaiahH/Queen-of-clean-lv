# Phase 1 report — Foundation and design

Date: 2026-11-22

## Starting point

The repository already contained a working platform (Next.js 16, Postgres/Supabase, server-side pricing engine, quote wizard with availability-checked booking, admin with calendar, CRM, quotes, cleaners, finance, reports, roles, RLS, Resend email, recurring schedules, and unit, integration and browser tests). Phase 1 kept all of it and changed the brand and public site to match the master build spec.

## What changed

**Brand assets**
- The owner's two logo files are now used directly (no redrawn versions):
  - `public/images/queen-of-clean-logo.png`: full wordmark, trimmed, transparent.
  - `public/images/queen-crowned-q.png`: crowned Q, trimmed, transparent.
- Favicon (`src/app/icon.png`), Apple touch icon (`src/app/apple-icon.png`) and phone home-screen icons (`public/images/app-icon-*.png`, via `src/app/manifest.ts`) are generated from the crowned Q.
- `src/components/brand/Logo.tsx` serves the files through `next/image` (automatic WebP/AVIF and sizing).

**Design system** (`src/app/globals.css`)
- Spec palette applied. Two small-text tones were deepened slightly for WCAG AA contrast (see README).
- Tighter corners, flat gold buttons, a thin gold section divider, and lining numerals for the serif.
- Fonts are self-hosted instead of loaded from Google, so pages don't wait on a third-party server.

**Public site**
- The header is light, with the full logo on desktop and the crowned Q on mobile. The CTA reads "Get My Free Quote".
- The homepage follows the spec's 11 sections:
  1. Hero, with the spec headline and copy.
  2. Why choose us.
  3. Services, with "from" prices taken from published pricing.
  4. How it works.
  5. Recurring plans.
  6. What makes us different.
  7. Reviews: only shown when real, permission-confirmed testimonials exist.
  8. Service area.
  9. FAQ.
  10. Final CTA.
  11. Footer.
- Each service has its own page at `/services/[slug]`, with:
  - The description.
  - "How frequency affects your price" (recurring).
  - Starting prices and scope.
  - Relevant add-ons with prices.
  - Per-page SEO title, description and canonical URL.
- `/services` is the overview, with add-on prices.
- Future services stay hidden. Airbnb turnover and a new **Commercial Cleaning** entry are seeded as inactive, and their pages return 404 until an admin enables them.
- Plan buttons preselect the frequency in the quote wizard (`/quote?service=recurring&frequency=weekly`).

**Owner-editable content** (Admin → Settings → Business): new fields
- Hero headline, hero text, and hero photo address with alt text.
- "What makes us different" items.
- Communities shown on the site.
- Social media links.
- The tagline now defaults to "Crowned in Cleanliness. Trusted in Care."

**Maintenance**
- Next.js 16.4.0 → **16.4.6**. 16.4.0 has a published security advisory and its build refused to run.
- Fixed the e2e setup ignoring `DATABASE_URL` when `E2E_DATABASE_URL=` is present but empty.

## Testing

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Pass |
| Unit tests | 41 / 41 pass |
| Integration tests (real Postgres) | 16 / 16 pass |
| Browser tests (Pixel 7) | 10 / 10 pass, including the full phone booking → confirm → assign → cleaner → complete path |
| `npm run build` | Pass |
| No horizontal scrolling | Checked on `/`, `/services`, `/services/recurring` and `/quote` at 375, 390, 430, 820 and 1440 px |
| Hidden services | `/services/turnover` and `/services/commercial` return 404 |

## Needs the owner

- **Hero photo:** no real photography was supplied. Add your own photo address in Settings → Business; until then the hero shows the logo.
- **Phone, email, social links:** blank until entered; nothing is shown publicly while blank.
- **Existing databases:** the new service descriptions and the Commercial entry apply to fresh seeds. An existing database keeps its current text (editable in Pricing & Services).

## Remaining phases

- **Phase 2:**
  - Property photo uploads (private storage).
  - Separate move-in / move-out choice.
  - Flooring and occupants fields.
  - Hero photo upload using the same storage.
- **Phase 3:** repeat-safe seed of the 7 existing customers with their historical rates, plus an admin review of the CRM against the spec.
- **Phase 4:**
  - Stripe in test mode: Checkout, verified webhooks, deposits (fixed, percent, full or after service), invoices and receipts, payment links.
  - Optional Twilio SMS.
- **Phase 5:**
  - Customer portal accounts.
  - Las Vegas area landing pages with unique content.
  - Sitemap, robots and LocalBusiness/Service structured data.
  - The full `docs/` set.
  - Final mobile, security and performance pass.
