import { DateTime } from "luxon";
import { parseMoneyToCents } from "@/lib/money";

/** Fields a spreadsheet column can be mapped to. "ignore" drops the column; "note" keeps it as a note. */
export const IMPORT_FIELDS = {
  ignore: "Ignore this column",
  note: "Keep as a note",
  full_name: "Customer name",
  email: "Email",
  phone: "Phone",
  area: "Area / neighborhood",
  address_line1: "Street address",
  zip: "ZIP code",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  sqft: "Square feet",
  frequency: "Frequency",
  current_price: "Current price",
  new_price: "New / agreed price",
  cleaning_hours: "Cleaning time (hours)",
  cleaner: "Cleaner",
  cleaner_pay: "Cleaner pay (per visit)",
  supplies: "Supplies (per visit)",
  next_cleaning: "Next cleaning date",
  notes: "Notes",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

/** Columns whose spreadsheet values are derived from other columns; we recalculate instead of importing. */
const DERIVED_HEADERS = ["profit", "monthly revenue", "monthly rev"];

const HEADER_GUESSES: [RegExp, ImportField][] = [
  [/^(customer|client|name|customer name|client name)$/i, "full_name"],
  [/e-?mail/i, "email"],
  [/phone|cell|mobile/i, "phone"],
  [/^(area|neighborhood|neighbourhood|city|location)$/i, "area"],
  [/address|street/i, "address_line1"],
  [/^zip|postal/i, "zip"],
  [/^bed/i, "bedrooms"],
  [/^bath/i, "bathrooms"],
  [/sq\.? ?ft|square/i, "sqft"],
  [/freq/i, "frequency"],
  [/^current price|^price$|^current rate/i, "current_price"],
  [/^new price|agreed|^new rate/i, "new_price"],
  [/time|hours|hrs/i, "cleaning_hours"],
  [/^cleaner$|^cleaners$|^team$/i, "cleaner"],
  [/cleaner pay|pay/i, "cleaner_pay"],
  [/suppl/i, "supplies"],
  [/next/i, "next_cleaning"],
  [/note|comment/i, "notes"],
];

export function guessMapping(headers: string[]): ImportField[] {
  return headers.map((h) => {
    const t = h.trim();
    if (DERIVED_HEADERS.includes(t.toLowerCase())) return "ignore";
    for (const [re, f] of HEADER_GUESSES) if (re.test(t)) return f;
    return t ? "note" : "ignore";
  });
}

export type Issue = { field: string; level: "error" | "warning"; message: string };

export type ParsedCustomer = {
  full_name: string;
  email: string | null;
  phone: string | null;
  area_name: string | null;
  address_line1: string | null;
  zip: string | null;
  bedrooms: number | null;
  full_baths: number | null;
  half_baths: number;
  sqft: number | null;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "one_time" | null;
  agreed_price_cents: number | null;
  estimated_minutes: number | null;
  next_cleaning: string | null; // ISO date, informational only
  notes: string[]; // preserved unknown / ambiguous values, reviewable
};

export type ReviewRow = {
  index: number; // 1-based row number in the source (excluding header)
  raw: Record<string, string>;
  parsed: ParsedCustomer;
  issues: Issue[];
  duplicates: { id: string; name: string; reason: string }[];
  decision: "import" | "skip";
};

const SPREADSHEET_ERROR = /^#(VALUE!|REF!|DIV\/0!|N\/A|NAME\?|NUM!|NULL!|SPILL!|CALC!)$/i;

function cleanNumber(raw: string): number | null {
  const s = raw.replace(/[,~\s]|sq\.?\s*ft|sqft|hrs?|hours?|bd|ba|bed(room)?s?|bath(room)?s?/gi, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

function parseFrequency(raw: string): ParsedCustomer["frequency"] | undefined {
  const s = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  if (/^(weekly|every week|1 ?x ?week|once a week)$/.test(s)) return "weekly";
  if (/^(bi ?weekly|every (2|two|other) weeks?|2 ?weeks?|eow)$/.test(s)) return "biweekly";
  if (/^(monthly|every month|once a month|1 ?x ?month|every 4 weeks)$/.test(s)) return "monthly";
  if (/^(quarterly|every 3 months)$/.test(s)) return "quarterly";
  if (/^(one ?time|once|1 ?time|single|deep|move ?out)$/.test(s)) return "one_time";
  return undefined;
}

function parseDate(raw: string, today: DateTime): string | null {
  const s = raw.trim();
  const formats = ["M/d/yyyy", "M/d/yy", "yyyy-MM-dd", "M-d-yyyy", "LLL d, yyyy", "LLLL d, yyyy", "LLL d", "LLLL d", "M/d"];
  for (const f of formats) {
    const dt = DateTime.fromFormat(s, f, { zone: "UTC" });
    if (dt.isValid) {
      // Formats without a year: assume the next occurrence from today.
      if (!/y/.test(f)) {
        let withYear = dt.set({ year: today.year });
        if (withYear < today.startOf("day")) withYear = withYear.plus({ years: 1 });
        return withYear.toISODate();
      }
      return dt.toISODate();
    }
  }
  // Excel serial dates (e.g. 45950) from XLSX cells formatted as numbers.
  if (/^\d{5}$/.test(s)) return DateTime.fromISO("1899-12-30", { zone: "UTC" }).plus({ days: Number(s) }).toISODate();
  return null;
}

/**
 * Turns raw spreadsheet rows into reviewable records. Never guesses silently: anything that does
 * not parse cleanly is kept as a note on the record and flagged.
 */
export function reviewRows(
  headers: string[],
  rows: string[][],
  mapping: ImportField[],
  ctx: {
    areas: string[];
    existing: { id: string; full_name: string; email: string | null; phone: string | null }[];
    today?: DateTime;
  },
): ReviewRow[] {
  const today = ctx.today ?? DateTime.now().setZone("America/Los_Angeles");
  const areaByLower = new Map(ctx.areas.map((a) => [a.toLowerCase(), a]));
  const out: ReviewRow[] = [];

  rows.forEach((cells, i) => {
    const raw: Record<string, string> = {};
    headers.forEach((h, c) => (raw[h || `Column ${c + 1}`] = (cells[c] ?? "").trim()));
    const issues: Issue[] = [];
    const p: ParsedCustomer = {
      full_name: "",
      email: null,
      phone: null,
      area_name: null,
      address_line1: null,
      zip: null,
      bedrooms: null,
      full_baths: null,
      half_baths: 0,
      sqft: null,
      frequency: null,
      agreed_price_cents: null,
      estimated_minutes: null,
      next_cleaning: null,
      notes: [],
    };
    let currentPrice: number | null = null;
    let newPrice: number | null = null;

    const keep = (header: string, value: string, why: string, level: Issue["level"] = "warning") => {
      p.notes.push(`${header}: ${value}`);
      issues.push({ field: header, level, message: why });
    };

    mapping.forEach((field, c) => {
      const header = headers[c] || `Column ${c + 1}`;
      const value = (cells[c] ?? "").trim();
      if (!value || field === "ignore") return;
      if (SPREADSHEET_ERROR.test(value)) {
        issues.push({ field: header, level: "warning", message: `Spreadsheet formula error (${value}) — not imported` });
        return;
      }
      switch (field) {
        case "note":
        case "notes":
          p.notes.push(field === "notes" ? value : `${header}: ${value}`);
          break;
        case "full_name":
          p.full_name = value.replace(/\s+/g, " ");
          break;
        case "email":
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) p.email = value.toLowerCase();
          else keep(header, value, "Not a valid email address — kept as a note");
          break;
        case "phone": {
          const digits = value.replace(/\D/g, "");
          if (digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))) p.phone = value;
          else keep(header, value, "Not a valid US phone number — kept as a note");
          break;
        }
        case "area": {
          const match = areaByLower.get(value.toLowerCase());
          if (match) p.area_name = match;
          else {
            p.area_name = null;
            keep(header, value, `"${value}" doesn't match a configured service area — kept as a note`);
          }
          break;
        }
        case "address_line1":
          p.address_line1 = value;
          break;
        case "zip":
          if (/^\d{5}(-\d{4})?$/.test(value)) p.zip = value.slice(0, 5);
          else keep(header, value, "Not a valid ZIP code — kept as a note");
          break;
        case "bedrooms": {
          const n = cleanNumber(value);
          if (n !== null && Number.isInteger(n) && n <= 20) p.bedrooms = n;
          else keep(header, value, "Bedrooms isn't a whole number — kept as a note");
          break;
        }
        case "bathrooms": {
          const n = cleanNumber(value);
          if (n !== null && n <= 20 && (n * 2) % 1 === 0) {
            p.full_baths = Math.floor(n);
            p.half_baths = n % 1 === 0.5 ? 1 : 0;
          } else keep(header, value, "Bathrooms isn't a number like 2 or 2.5 — kept as a note");
          break;
        }
        case "sqft": {
          const n = cleanNumber(value);
          if (n !== null && n >= 100 && n <= 50000) p.sqft = Math.round(n);
          else keep(header, value, "Square footage isn't a single number — kept as a note");
          break;
        }
        case "frequency": {
          const f = parseFrequency(value);
          if (f) p.frequency = f;
          else keep(header, value, "Frequency not recognized — kept as a note");
          break;
        }
        case "current_price":
        case "new_price": {
          const cents = parseMoneyToCents(value);
          if (cents !== null && cents >= 0 && cents <= 1_000_000) {
            if (field === "current_price") currentPrice = cents;
            else newPrice = cents;
          } else keep(header, value, "Price isn't a dollar amount — kept as a note");
          break;
        }
        case "cleaning_hours": {
          const n = cleanNumber(value);
          if (n !== null && n > 0 && n <= 16) p.estimated_minutes = Math.round(n * 60);
          else keep(header, value, "Cleaning time isn't a number of hours — kept as a note");
          break;
        }
        case "cleaner":
          p.notes.push(`Cleaner (from spreadsheet): ${value}`);
          break;
        case "cleaner_pay":
        case "supplies": {
          const cents = parseMoneyToCents(value);
          if (cents !== null) p.notes.push(`${field === "cleaner_pay" ? "Historical cleaner pay" : "Historical supplies"} per visit: $${(cents / 100).toFixed(2)}`);
          else keep(header, value, "Not a dollar amount — kept as a note");
          break;
        }
        case "next_cleaning": {
          const d = parseDate(value, today);
          if (d) {
            p.next_cleaning = d;
            p.notes.push(`Next cleaning per spreadsheet: ${d} (not scheduled automatically)`);
          } else keep(header, value, "Next cleaning isn't a date — kept as a note");
          break;
        }
      }
    });

    if (newPrice !== null) p.agreed_price_cents = newPrice;
    else if (currentPrice !== null) p.agreed_price_cents = currentPrice;
    if (newPrice !== null && currentPrice !== null && newPrice !== currentPrice) {
      p.notes.push(`Previous price: $${(currentPrice / 100).toFixed(2)}`);
      issues.push({ field: "price", level: "warning", message: "Current and new prices differ — using the new price; confirm it's agreed" });
    }

    if (!p.full_name) issues.push({ field: "full_name", level: "error", message: "Customer name is required" });
    else if (!/[a-z]/i.test(p.full_name) || p.full_name.length > 120)
      issues.push({ field: "full_name", level: "error", message: "Customer name looks invalid" });
    if (p.full_name && !/\s/.test(p.full_name))
      issues.push({ field: "full_name", level: "warning", message: "Only one name given — add a last name if you know it" });

    const duplicates: ReviewRow["duplicates"] = [];
    const lname = p.full_name.toLowerCase();
    const digits = p.phone?.replace(/\D/g, "").slice(-10);
    for (const ex of ctx.existing) {
      if (p.email && ex.email && ex.email.toLowerCase() === p.email) duplicates.push({ id: ex.id, name: ex.full_name, reason: "same email" });
      else if (digits && ex.phone && ex.phone.replace(/\D/g, "").slice(-10) === digits) duplicates.push({ id: ex.id, name: ex.full_name, reason: "same phone" });
      else if (lname && ex.full_name.toLowerCase() === lname) duplicates.push({ id: ex.id, name: ex.full_name, reason: "same name" });
    }
    for (const prev of out) {
      if (lname && prev.parsed.full_name.toLowerCase() === lname)
        duplicates.push({ id: `row-${prev.index}`, name: prev.parsed.full_name, reason: `same name as row ${prev.index} in this file` });
    }
    if (duplicates.length) issues.push({ field: "full_name", level: "warning", message: "Possible duplicate — review before importing" });

    out.push({
      index: i + 1,
      raw,
      parsed: p,
      issues,
      duplicates,
      decision: issues.some((x) => x.level === "error") || duplicates.length ? "skip" : "import",
    });
  });
  return out;
}

export function summarize(rows: ReviewRow[]) {
  return {
    total: rows.length,
    to_import: rows.filter((r) => r.decision === "import").length,
    skipped: rows.filter((r) => r.decision === "skip").length,
    with_errors: rows.filter((r) => r.issues.some((i) => i.level === "error")).length,
    with_warnings: rows.filter((r) => r.issues.some((i) => i.level === "warning")).length,
    possible_duplicates: rows.filter((r) => r.duplicates.length > 0).length,
  };
}
