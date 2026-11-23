# Importing existing customers and their historical rates

This import is for clients you already serve at agreed prices. Each customer keeps the exact rate on record. That rate is stored apart from the website's pricing and is never recalculated.

## The records file

The file is plain JSON (template: [`docs/examples/existing-customers.example.json`](examples/existing-customers.example.json)).

```json
{
  "source": "Where these records came from",
  "rate_basis": "per_visit",
  "customers": [
    { "ref": "client-001", "name": "Jordan Example", "frequency": "biweekly", "rate": 225, "bedrooms": 3, "bathrooms": 2, "sqft": 1750 }
  ]
}
```

**File-level fields**

| Field | Meaning |
|---|---|
| `source` | Where the records came from. It is saved on every imported customer. |
| `rate_basis` | Must be `"per_visit"`. The import refuses to guess what a rate covers. |

**Fields for each customer**

| Field | Meaning |
|---|---|
| `ref` | A permanent ID for that customer. It's how re-runs recognise them, so never reuse or change it. |
| `name` | Name exactly as in your records. |
| `frequency` | `weekly`, `biweekly`, `monthly`, `quarterly` or `one_time`. |
| `rate` | Price per visit in dollars. Whole cents only (`249.99` is fine, `249.999` is rejected). |
| `bedrooms` | Optional. |
| `bathrooms` | Optional. `2.5` means 2 full + 1 half; other fractions are rejected. |
| `sqft` | Optional. Either one number, or a range such as `{ "min": 2200, "max": 2400 }`. A range is kept as a note and the size field is left blank. |
| `notes` | Optional. Factual notes from your records. |

Anything not in the file stays blank: email, phone, address, ZIP, cleaner and next appointment. Fill these in on each profile once confirmed.

> **Keep the real file out of GitHub.** This repository is public. Put the file in the `private/` folder, which git ignores.

## Running it

**From the admin (works on a phone):** go to Import / Export → *Existing customers with historical rates*.
1. Choose the file.
2. Tap **Preview import**. It runs the whole import and then undoes it, so the preview is exactly what will happen.
3. Tap **Apply import**.
4. Download the report if you want a copy.

**From a computer:**

```bash
npm run import:existing -- private/existing-customers.json            # preview, nothing saved
npm run import:existing -- private/existing-customers.json --apply    # save
```

The command saves a report next to the file. It refuses any database that isn't on your own computer unless you add `--allow-remote-database`.

## What happens

| Result | Meaning |
|---|---|
| **Created** | New customer with status *Existing client — verify current status*, one property, and their historical rate. No visits, schedules, quotes or charges. |
| **Already imported** | That `ref` was imported before and nothing differs. Nothing changes. |
| **Conflict** | Something differs: staff edited the customer, changed their rate, or the file changed. **The values in the system are kept**; the report lists the differences. This also covers an existing customer with the same name who wasn't imported: the import won't guess they're the same person. |
| **Error** | The record can't be read reliably (e.g. 2.25 bathrooms, a rate with fractions of a cent, or a duplicate `ref`). Other records still import. |

Re-running is always safe, including two runs at the same moment (they take turns).

## After importing

On each customer's profile:

1. Check the details. Tap **Confirm active**, or **No longer a client**. Booking them a confirmed visit also marks them active.
2. Add contact details and the street address. A visit can't be booked without an address.
3. Tap **Book cleaning**. The dialog shows *Rates on file* and pre-fills the historical rate. **Use this rate** also sets the service and frequency. If you type a different price, it says so.

**Changing a rate later:** use **Customer rates → Change**. The old rate moves to the history and is never deleted. Only owners and admins can change rates; office staff can see them.

**What rates never affect:**
- They never change the website's pricing.
- They're never applied to anyone else. A new customer with an identical home still gets the standard estimate.
- They're never applied automatically to a website request, even from the same email address. Staff choose to use them.
