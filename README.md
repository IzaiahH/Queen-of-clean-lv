# Queen of Clean LV

Website and business management app for Queen of Clean LV, a residential cleaning business in Las Vegas.

- **Public site:** home, services, a multi-step quote calculator with online booking against real availability, contact form, a customer "manage my booking" page and secure quote links.
- **Admin (`/admin`):** a calendar-first back office:
  - Dashboard, Calendar, Appointments, Customers (CRM), Quotes, Cleaners.
  - Pricing & Services, Revenue & Expenses, Reports, Import / Export.
  - Settings (business info, booking rules, policies, emails, operations, testimonials and team logins).
- **Cleaner logins:** cleaners see only their own assigned jobs, with no prices or financial data.

The owner's guide is in [OWNER-GUIDE.md](OWNER-GUIDE.md).

---

## Architecture

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, server components and server actions), React 19, strict TypeScript |
| Styling | Tailwind CSS v4. Brand tokens live in `src/app/globals.css` (`@theme`); components use tokens only |
| Database | Postgres (Supabase in production), accessed **only from the server** with `postgres` (porsager) |
| Auth | Supabase Auth (production) or built-in local accounts (development), mapped to `profiles` with roles |
| Email | Resend HTTP API, with every message logged in `communications` |
| Calendar | FullCalendar 6 (month, week, day, agenda) with named-timezone support via Luxon |
| Hosting | Vercel, with a daily Vercel Cron job |

### How data stays private

- **No database access from the browser.**
  - The browser never talks to the database or to Supabase's data API.
  - All reads and writes go through server components, server actions (`src/app/admin/actions/*`) and route handlers (`src/app/api/*`).
  - These run on the server with `DATABASE_URL`.
- **Row-level security is a backstop.**
  - RLS is enabled on every table with no policies for `anon` or `authenticated`.
  - So even the public Supabase key can't read a single row.
  - An integration test checks this for customers, properties, appointments, quotes, payments, expenses, communications and cleaners.
- **Every admin entry point checks permissions on the server.**
  - Pages use `requirePage(capability)`; actions and APIs use `requireCap(capability)`, via `src/lib/auth/session.ts`.
  - The capability matrix is in `src/lib/auth/permissions.ts`.
  - `src/proxy.ts` only redirects visitors who have no session cookie at all; it is a convenience, not the security boundary.
- **Roles:**
  - **Owner:** everything, including team logins.
  - **Admin:** everything except team logins.
  - **Office:** schedule, customers, quotes and cleaners, but no finance, pricing, reports, import/export or settings.
  - **Cleaner:** only `/admin/my-jobs`.
  - Cleaner pay rates are stripped from pages for roles without `cleaners.pay`.
- **Secrets stay server-side.**
  - `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `DATABASE_URL` and `CRON_SECRET` never have a `NEXT_PUBLIC_` prefix and are only read in server modules.
  - Those modules are marked `import "server-only"`.
- **Public links use secrets that are only stored hashed.**
  - Customer manage links and quote links contain random 256-bit tokens; the database stores only their SHA-256 hashes.
  - Manage links are re-issued with each email, so older links stop working.
  - Entry instructions are never put in emails or public pages.
- **Public forms are protected against abuse.**
  - The booking, quote and contact forms are rate limited per (hashed) IP.
  - They also have a honeypot field and a minimum fill time.
  - Sign-in is limited to 5 failed attempts per email and 10 per IP every 15 minutes.

### Scheduling correctness

- **No double booking.** Two layers prevent it:
  - Bookings take a transaction-scoped advisory lock (`lockSchedule`) and re-check the slot inside the lock.
  - A Postgres exclusion constraint on `appointment_assignments (cleaner_id, during)` makes overlapping jobs for the same cleaner impossible, even under concurrency or a bug in app code.
- **Availability.** `src/lib/scheduling/availability.ts` combines:
  - Business hours, lead time and the booking window.
  - Blocked times and the daily job limit.
  - Each cleaner's working hours, time off, capabilities, per-day limit and the travel buffer.
- **Recurring schedules** live in `recurring_series`. `src/lib/scheduling/recurrence.ts` (pure) and `src/lib/server/series.ts` (database) handle them:
  - Visits are generated a configurable number of weeks ahead.
    - The daily cron and every change to a schedule extend this window.
    - `(series_id, occurrence_date)` is unique, so re-running generation never duplicates a visit.
    - A skipped (cancelled) visit is never recreated.
  - Times are wall-clock in `America/Los_Angeles`, so visits stay at 9:00 AM across DST changes.
  - Monthly visits anchored on the 29th–31st fall on the last day of shorter months.
  - Edits can apply to one visit, this and future visits, or all upcoming visits. Individually edited visits are marked as exceptions and kept.
  - Pause removes untouched future visits; resume regenerates them. Cancel cancels all upcoming visits.
  - Conflicts found during generation are flagged on the appointment for review, never overbooked.

### Pricing

- Prices are versioned JSON rules in `pricing_versions`:
  - Exactly one version is published and at most one is a draft.
  - Rules are validated with zod (`src/lib/pricing/rules.ts`).
  - Amounts are calculated in integer cents.
- Admins edit a draft, compare it against live prices in the test panel, then publish. Quotes keep a reference to the version that priced them.
- Price overrides on a quote require a reason and record the user and time.
- The server always re-prices; prices sent from the browser are never trusted.

### Money terms (kept separate everywhere)

- **Estimated:** quote estimates.
- **Booked:** agreed prices of confirmed or completed appointments.
- **Completed revenue:** the amount recorded when a job is marked complete.
- **Job profit:** completed revenue minus cleaner pay, supplies and other job costs.
- **Operating profit:** job profit minus general expenses.
- **Projections:** recurring projections are labeled as projections.

### Email honesty

`sendTemplatedEmail` writes a `communications` row for every attempt. It is marked:

- `sent` only when Resend accepts the message.
- `skipped` when email isn't configured, the customer has no address, or customer emails are turned off.
- `failed` with Resend's error.

The UI reports exactly that, and failed or skipped emails can be retried from the appointment panel or Settings → Emails.

### Code map

```
src/app/(site)/          public pages          src/app/admin/(app)/   admin pages
src/app/api/             route handlers        src/app/admin/actions/ server actions (all permission-checked)
src/lib/server/          database + business logic (server-only)
src/lib/pricing|scheduling|finance|import/  pure, unit-tested logic
src/components/          UI (public/, admin/, ui/, brand/)
supabase/migrations/     schema (single source of truth)
scripts/                 migrate, seed, demo seed, create-admin
tests/unit|integration|e2e
```

---

## Local setup

Requirements: Node 20+ (tested on 22) and Postgres 15+ (tested on 16).

```bash
npm install
cp .env.example .env.local          # then edit DATABASE_URL etc.
createdb qoc                        # or any empty database
npm run db:migrate                  # applies supabase/migrations/*.sql (and Supabase role stubs for plain Postgres)
npm run db:seed                     # services, add-ons, Las Vegas areas, first published prices; no customer data
npm run admin:create -- --email you@example.com --name "Your Name" --role owner   # prompts for a password (12+ chars)
npm run dev                         # http://localhost:3000, admin at /admin
```

Optional synthetic demo data (invented names, `example.com` addresses; refuses to run in production):

```bash
npm run db:seed:demo
```

## Supabase setup

1. **Create a project** at supabase.com in a US West region.
2. **Get the connection strings** from Project → Connect:
   - `DATABASE_URL`: the **Transaction pooler** URI (port 6543). The app disables prepared statements, so it works with the pooler.
   - `DATABASE_URL_DIRECT`: the **Direct connection** or **Session pooler** URI (port 5432). Migrations use it.
3. **Run the migrations and base seed** from your machine, with those values in `.env.local`:
   ```bash
   npm run db:migrate && npm run db:seed
   ```
   You can also paste `supabase/migrations/*.sql` into the SQL editor in order, then run `npm run db:seed`.
4. **Set the Auth variables.** In Project Settings → API, copy:
   - The URL into `NEXT_PUBLIC_SUPABASE_URL`.
   - The publishable (anon) key into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - The service-role key into `SUPABASE_SERVICE_ROLE_KEY` (server only).
   - Then set `AUTH_PROVIDER=supabase`.
5. **Lock down sign-ups.** In Authentication → Providers → Email, **turn off "Allow new users to sign up"**. Staff accounts are only created by the owner (Settings → Team logins) or the CLI below.
6. **Create the first owner:**
   ```bash
   AUTH_PROVIDER=supabase npm run admin:create -- --email owner@yourdomain.com --name "Owner Name" --role owner
   ```
   This creates the Supabase Auth user with the service-role key and links it to a `profiles` row. You can set `ADMIN_PASSWORD` in the environment to avoid the prompt in automation.

## Email setup (Resend)

1. Create a Resend account and add your domain under **Domains**.
2. Add the DNS records Resend shows (SPF/DKIM TXT records, and the MX record for bounces) at your DNS provider. Wait until Resend shows the domain as **Verified**.
3. Create an API key with sending access and set:
   - `RESEND_API_KEY`.
   - `EMAIL_FROM`, e.g. `Queen of Clean LV <hello@yourdomain.com>`, using the verified domain.
   - Optionally `EMAIL_REPLY_TO`.
4. In Admin → Settings → Emails, use **Send me a test** on any template. It goes to your own login email, and the log shows whether Resend accepted it.

Until steps 1–3 are done, everything still works, but emails show as **Not sent** in the log. Customers see "we couldn't send the confirmation email" rather than a false claim.

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel. The framework preset is Next.js, with the default build command.
2. Add every variable from `.env.example` that applies. In production these are required:
   - `DATABASE_URL`, `APP_URL` (your final https URL), `AUTH_PROVIDER=supabase` and the three Supabase variables.
   - `SESSION_SECRET` and `CRON_SECRET` (long random strings).
   - `RESEND_API_KEY` and `EMAIL_FROM`.
3. Deploy. `vercel.json` schedules `/api/cron/daily` at 14:00 UTC (6–7 AM in Las Vegas). The daily job:
   - Extends recurring schedules.
   - Sends reminder and follow-up emails.
   - Expires old quotes.
   - Deletes handled contact messages past the retention period, expired sessions and old rate-limit rows.

   Vercel sends `Authorization: Bearer $CRON_SECRET` automatically. Without the right secret the route returns 401.
4. Add your domain in Vercel and update `APP_URL` to match.

Reminder timing: on Vercel's Hobby plan cron runs once a day, so "reminder 24 hours before" goes out in the morning batch for any confirmed visit starting within the next 24 hours. On Pro you can change the schedule in `vercel.json` to hourly (`0 * * * *`). Each visit only ever gets one reminder.

## Tests

```bash
npm run lint            # ESLint (Next.js + React hooks rules)
npm run typecheck       # tsc --noEmit, strict
npm test                # unit tests: pricing, availability, recurrence (DST, month-end), finance, import parsing, permissions
npm run test:integration   # needs Postgres; rebuilds TEST_DATABASE_URL (name must end in _test) from the migrations
npm run build
npm start & npm run test:e2e   # Playwright on a phone viewport against the running app; uses DATABASE_URL (local only by default)
```

**Integration tests** (`tests/integration`) run the real server code against a real database:

- Booking creates the customer, property, quote, appointment and assignment, and logs the email honestly.
- A duplicate submission returns the original booking.
- Three concurrent bookings for one cleaner result in exactly one booking.
- An existing customer is matched by email without being overwritten.
- Cancelling frees the slot.
- A forced reschedule can never overlap the cleaner's jobs.
- Recurring generation:
  - Keeps the same local time and is idempotent.
  - Editing one visit leaves the series alone; "this and future" keeps edited visits.
  - A skip survives regeneration, and pause/resume don't duplicate.
  - Conflicts are flagged, not double-booked.
  - Monthly-on-the-31st falls on each month's last day.
- Published price changes leave earlier quotes and their version untouched.
- Import:
  - Flags problems, catches duplicates and keeps provenance notes.
  - Schedules nothing.
  - A batch can't be committed twice.
- Customer merge moves history and archives the duplicate.
- Row-level security denies `anon` and `authenticated` reads.
- Daily reminders are logged once and never reported as sent without a provider.

**Browser tests** (`tests/e2e`, Pixel 7 viewport):

- Signed-out visitors are redirected away from admin pages and get 401 from admin, export and cron APIs.
- A cleaner login only reaches My jobs, gets 403 from admin APIs and sees no prices.
- The full path:
  1. A customer books on a phone through the quote wizard.
  2. The owner confirms and assigns a cleaner.
  3. The cleaner sees the job.
  4. The owner marks it complete.

  The test moves the visit into the past directly in the database so it can be completed, standing in for time passing.

---

## Defaults chosen (change any of them in Admin)

- **Colors:** the brand palette (obsidian, midnight, antique gold, champagne, ivory, cream, espresso, charcoal) replaces the earlier emerald/green direction.
- **Starting prices are a draft for the owner to review:**
  - Weekly $165, every 2 weeks $185, monthly $210.
  - Queen Reset (deep clean) $275.
  - These replace the $125/$180/$200 shown on the reference image.
  - Add-ons and size bands are also starter values. Admin → Pricing & Services shows them all, and nothing is final until the owner publishes.
- **Logo:** the crown and wordmark are recreated as vector art. The owner can upload a PNG, JPG or WebP logo in Settings → Business.
- **No customers were seeded.** The customer tracker screenshot wasn't provided. Use Admin → Import / Export to bring in a spreadsheet; nothing is imported or scheduled without review.
- **Online bookings start as "Pending review."** Auto-confirm is off; turn it on in Settings → Booking, with a price cap and a returning-customers-only option.
- **Booking rules:**
  - Business hours Monday–Friday 8 AM–5 PM.
  - 24-hour lead time and a 30-minute travel buffer.
  - At most 4 jobs a day; recurring visits generated 8 weeks ahead.
- **Worker classification:** cleaners default to worker type "Not specified." The app never assumes contractor or employee status; pick the right one with an accountant.
- **Policies are starter drafts.** The public Terms and Privacy pages say "being finalized" until the owner ticks "reviewed" in Settings → Policies.
- **No invented credentials.** Homepage copy contains no awards, reviews, licenses, insurance or guarantees. Testimonials appear only after the owner adds them and confirms the customer's permission.

## Known limitations

- **Supabase Auth and Resend were not tested live.** No credentials were available. Both are implemented against their documented APIs, and every test here ran with local auth and no email provider. Do a test sign-in and a **Send me a test** email after setting them up.
- **No online payments.** Payments are recorded manually (cash, card, Zelle, Venmo, check or other); no card data is ever stored.
- **No SMS.** Settings shows that text messages aren't connected. A customer's contact preference (email, call or text) is shown on their profile so the team can text them by hand.
- **No photo uploads** on jobs or customers. Job notes and checklists are text only.
- **The logo upload is stored in the database** as a small data URL (under 280 KB), not in object storage.
- **No stock photography.** The site uses typography, the crown emblem and illustration; add real photos of your work when you have them.
- **Manage links rotate.** Each new email to a customer issues a fresh manage link and older links stop working. This is intentional, so a forwarded old email can't be used to change a booking.
- **Spreadsheet import** handles CSV and the first sheet of an XLSX file, up to 2,000 rows.
- **Reminders run in a daily batch** on Vercel Hobby (see Deploying).
- **Business copy needs the owner's review.** The default text (About, Why choose us, FAQs) is generic. Settings → Business lets the owner edit all of it.
