# Phase 2 report: Quote and booking intake

Date: 2026-11-23 · Branch: `phase-2-quote-intake` (built on `phase-1-brand-site`)

## Already in place before this phase

These spec items were already built, and this phase kept them as they were:

- Server-side pricing engine with versioned, admin-editable rules.
- Server repricing of every submission; browser prices are never trusted.
- Manual-review routing for heavily soiled homes, unusual sizes and custom services.
- Availability that accounts for cleaners, job length, travel buffers, business hours, blocked dates and lead time.
- Double-booking protection (a database lock plus an exclusion constraint).
- Idempotent submissions.
- "Pending" labelling for requests that still need approval.

## What changed

**Quote form**
- Move-in and move-out cleaning are separate choices in Step 1. The server requires one of them for move cleanings.
- The condition options use the spec's wording, each with a short explanation:
  - "Well maintained"
  - "Average"
  - "Needs extra attention"
  - "Heavily soiled / requires special assessment" (always sent for manual review)
- New fields:
  - Flooring types (multiple choice).
  - Parking instructions.
  - "Who lives in the home?" (occupants).
- **Property photo uploads:** up to 6 per request, optional, from the Details step.
  - The phone shrinks each photo before upload, so it works on mobile data.
  - The server checks the file's actual contents, re-encodes it, limits it to 2000px, and **removes all metadata, including GPS location**.
  - Each photo is stored privately in the database (`uploaded_images`) with a one-time key held only by the uploading browser. Nobody can attach or delete someone else's photo.
  - Photos that are uploaded but never submitted are deleted by the daily cleanup after 24 hours.
  - Upload limits: 30 per hour per connection and 10 MB per file.

**Admin**
- The quote page shows the move type, flooring, household details and the customer's photos.
- The appointment page shows flooring, parking and photos. Parking is also added to the visit's entry notes, so the assigned cleaner sees it.
- Photos load only through `/api/admin/images/[id]`, which requires owner, admin or office access. Cleaners and the public get 401/403.
- Settings → Business has a **hero photo upload**. Website images are public at `/media/[id].jpg`; customer photos can never be served from that address.

**Database:** one new additive migration, `20261123000000_intake_and_images.sql`.
- New columns: `properties.flooring` and `properties.parking_instructions`.
- New table `uploaded_images`, with row-level security on and no public access.
- No existing data is changed.

## Testing

| Check | Result |
|---|---|
| Typecheck, lint, production build | Pass |
| Unit tests | 41 / 41 |
| Integration tests (real Postgres) | 21 / 21. 5 are new: metadata stripping, rejecting fake image files, key-protected attaching that can't be reused, removal and cleanup, and move-in/out + flooring + parking (parking never leaks into the customer-visible quote) |
| Browser tests (phone) | 10 / 10. The booking test now picks flooring, adds parking and uploads a photo. It also checks that the owner can open the photo and a signed-out browser gets 401 |
| Hero upload | Admin upload → saved → shown on the homepage → served publicly as a JPEG |

## Owner action

- **Apply the migration** to your Supabase database before deploying this branch: `npm run db:migrate` with the production `DATABASE_URL`. It only adds a table and columns.

## Remaining phases

- **Phase 3:**
  - Repeat-safe import of the 7 existing customers with their historical rates.
  - CRM check against the spec.
  - Customer photos on the customer profile page.
- **Phase 4:**
  - Stripe in test mode: deposits, verified webhooks, invoices and receipts, payment links.
  - Optional Twilio SMS.
- **Phase 5:**
  - Customer portal accounts.
  - Las Vegas area landing pages.
  - Sitemap, robots and structured data.
  - The full `docs/` set.
  - Final security and performance pass.
