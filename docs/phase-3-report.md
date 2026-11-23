# Phase 3 report: Customer import and historical pricing

> **Status: ready for owner approval, pending answers to Q1–Q5 below.** Not merged, not deployed; Phase 4 not started.

Date: 2026-11-23 · Branch: `phase-3-customer-import` (built on `phase-2-quote-intake`). Not merged; production untouched.

## What I inspected first

| Area | Finding |
|---|---|
| `customers` | Had no fields for historical rate, preferred frequency or an import key. Status allowed `lead / active / inactive / archived`. |
| `properties` | Bedrooms, full and half baths, and sq ft already existed. Address, city and ZIP are nullable or defaulted. |
| Pricing (`pricing_versions`) | One versioned rule set for the website, with no per-customer concept. |
| Quotes / bookings | Website prices always come from the engine. Staff bookings take a typed price, pre-filled from the last visit. |
| `recurring_series` | Each schedule stores its own `price_cents`. |
| Payments / invoices | Linked to customers and appointments. This phase doesn't touch them. |
| Existing spreadsheet importer | For new contact lists. It has no concept of rates, and it matches by name, email or phone, so it isn't reliable for this. |

## What changed

**Database:** migration `20261124000000_customer_rates.sql`, additive only.
- New `customer_rates` table:
  - Customer-specific prices, separate from website pricing.
  - Kind: historical or custom. Status: active or retired.
  - At most one active rate per customer, service and frequency.
  - Changing a rate retires the old row, so history is kept.
  - Row-level security: owners and admins can edit, office staff can only read, the public has no access.
- New customer columns: `customers.import_ref` (unique) and `customers.preferred_frequency`.
- New customer status `unverified`, shown as "Existing client — verify current status".

**Import** (`src/lib/import/existing-customers.ts`)
- One engine behind both the admin page and `npm run import:existing`.
- A preview runs the full import inside a transaction and then rolls it back.
- Matching uses the record's `ref` only.
- It **never overwrites**: anything that differs from the system is reported as a conflict, and the system's value is kept.
- It **never guesses**:
  - A same-named customer who wasn't imported is a conflict.
  - A bathroom count other than whole or `.5` is an error.
  - A rate with fractions of a cent is an error.
  - A file that doesn't declare `rate_basis: per_visit` is refused.
  - Missing details stay blank.
- Concurrent runs are serialized with a lock.
- Each record gets a savepoint, so one bad record doesn't stop the others.
- Every run is audited. Applied runs also appear under Recent imports.
- Reports show created, unchanged, conflict, skipped and error counts, per-record details, and "please check" warnings.
- The command-line script refuses any database that isn't local unless `--allow-remote-database` is given.

**Admin**
- **Customer profile:**
  - A verify-status banner with **Confirm active** and **No longer a client**.
  - A **Customer rates** card with exact rate, frequency, service, source and date, plus change, retire and history.
  - Preferred frequency is shown.
  - "No contact details yet" replaces a default contact preference that was never given.
- **Customer list:** a "To verify" filter. The column now shows frequency and per-visit rate.
- **Booking dialog:**
  - Lists the customer's rates on file and pre-fills a single rate.
  - **Use this rate** sets service, frequency and price.
  - The price stays on the rate when frequency or service changes.
  - Typing a different price shows a warning.
- **Import / Export:** new *Existing customers with historical rates* section (preview → apply → download report).
- **Status:** booking a *confirmed* visit or schedule for an unverified customer marks them active. Pending requests don't.
- **Permissions:** new `customers.rates` permission (owner and admin).

**Privacy:** the repository is public, so the real records file lives in `private/`, which git ignores. Tests and the template use fictional people. `supabase/setup.sql` was regenerated (now 3 migrations) and contains no customer data.

## Your 7 customers: local import results

Run against the **local development database only**.

| Run | Created | Unchanged | Conflicts | Skipped | Errors |
|---|---|---|---|---|---|
| Preview | 7 (nothing saved) | 0 | 0 | 0 | 0 |
| Apply | 7 | 0 | 0 | 0 | 0 |
| Apply again | 0 | 7 | 0 | 0 | 0 |

Verified in the database after applying:

- All 7 customers have status `unverified`, and each historical rate matches the source file to the cent.
- Email, phone, address, city and ZIP are blank.
- There are 0 appointments, 0 schedules and 0 payments for them.

## Outstanding customer-data questions (awaiting owner)

Status: **open**. Until these are answered, the 7 imported records and their historical rates are **frozen**: nothing re-imported, edited or deleted, and nothing sent to production. Each question is described without identifying the customer, because this repository is public. The owner's private copy of this report names each record.

| # | Question | Current handling (nothing changes until answered) |
|---|---|---|
| Q1 | **Rate basis.** Are all 7 historical rates **per visit**? (Assumed because they match the published per-visit starting prices.) If any rate is per month, its record must be corrected before a production import. | All 7 stored as per visit, exact amounts. |
| Q2 | **Half bathroom.** One record gives a bathroom count ending in ".5". Is that one half bathroom? | Saved as that many full bathrooms + 1 half. |
| Q3 | **Size range.** One record gives square footage as a range, not one number. What's the actual size? The room count is also unusually high for that size; please confirm both. | Range kept as a note; size field left blank. |
| Q4 | **Possible duplicate.** Two records have identical home details, frequency and rate. Are they separate households, or one client recorded twice? | Both imported separately; the import report flags them. |
| Q5 | **Name.** One record's name looks like a family name or nickname. Is there a full name to use? | Imported exactly as written. |

Customer names and rates are deliberately not in this repository, because it is public. The owner has the full per-customer report privately.

## Tests

| Suite | Result | New in this phase |
|---|---|---|
| Unit | 46 / 46 | 5 tests: half-bath mapping, sq-ft range, whole-cent rates, and who can change or see rates |
| Integration (real Postgres) | 34 / 34 | 13 tests: the 9 listed below, plus 4 database-permission tests for rates |
| Browser (phone) | 11 / 11 | 1 test, described below |
| Typecheck, lint, build | Pass | — |

The 9 new integration tests check:
- A preview saves nothing.
- Rates are exact to the cent (including $249.99), nothing is invented, and nothing is booked or charged.
- Re-runs, including 3 at once, create no duplicates.
- Staff edits are never overwritten, and the historical rate stays in the history.
- A same-named customer is reported as a conflict.
- Bad records error out without blocking good ones, and an unclear rate basis is refused.
- Website pricing is unchanged, and a new customer with an identical home gets the standard price.
- Booking at the historical rate works for a one-off visit and for a recurring schedule, booking requires an address, and the customer becomes active.
- There's only ever one active rate per service and frequency, with history kept.

The new browser test covers, on a phone:
- Upload, preview and apply, then a re-run showing "2 unchanged".
- The profile shows the banner and the rate.
- The booking dialog pre-fills $285, "Use this rate" sets monthly, and a different price is flagged.
- **Confirm active** clears the banner.

## Readiness verification (2026-11-23)

| Check | How it was checked | Result |
|---|---|---|
| Imported records unchanged | Read-only query and fingerprint of the 7 records, plus the audit log | Unchanged since import: 7 active historical rates; all still "verify current status"; no rate or customer edits logged |
| No customer-identifying information on GitHub | Fetched the complete history of every branch (6 commits, 4 branches). Searched every file in every commit, every commit message and author field, and GitHub issues, pull requests and releases | No customer names anywhere. No issues, PRs or releases exist. **Finding:** commit `bdf33fd` contained test data and one documentation example that copied real records' home details and rates with invented names. Not identifying, but still real data. Replaced with invented values in a new commit (see below) |
| Private records excluded from Git | `git check-ignore`, `git ls-files`, and the full history | `private/` is ignored by `.gitignore`. 0 tracked files, never present in any commit, not listed as untracked |
| Historical rates can't become public pricing | Traced every read of `customer_rates` | Read in only 4 places: admin customer list and profile, staff customer search, the import, and the admin rate actions. All require a signed-in staff permission. The pricing engine, website pages and every public API never read it. Website prices for a new customer with an identical home are unchanged (integration test) |
| Office staff can view but not change rates | App permission table, server actions, and database row-level security | `customers.rates` (change) is owner/admin only; office has `customers.view`. Rate-change actions are guarded server-side by `customers.rates`. In the database, office staff can read rates, but updates and deletes affect 0 rows and inserts are rejected. Cleaners and the public see 0 rows. New automated test: `tests/integration/rates-security.test.ts` |

**Remaining exposure in history:** commit `bdf33fd` on the pushed `phase-3-customer-import` branch still contains the copied (unnamed) record details. Removing them completely means rewriting that branch's history and force-pushing it. That needs the owner's approval, so it has not been done. `main` and the Phase 1–2 branches never contained them.

## Not done (needs your approval)

- **Importing into production.** When you approve, either:
  - apply the migration, then use Import / Export → *Existing customers* with the private records file; or
  - run `npm run import:existing -- private/existing-customers.json --allow-remote-database` (preview first, then `--apply`).
- Merging the branches into `main`.
- Phase 4 (Stripe, invoices, SMS) waits for your sign-off on this phase.
