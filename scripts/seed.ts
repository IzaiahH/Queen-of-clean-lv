/**
 * Production-safe base seed: service catalog, add-ons, Las Vegas service areas and the first
 * published pricing version. Contains no customer data. Safe to re-run (skips existing rows).
 * Usage: npm run db:seed
 */
import postgres from "postgres";
import { DEFAULT_RULES } from "../src/lib/pricing/rules";
import { loadEnv } from "./env";

loadEnv();

const STANDARD_INCLUDES = [
  "Dust accessible surfaces, furniture and décor",
  "Wipe kitchen countertops, backsplash and appliance exteriors",
  "Clean sinks and faucets",
  "Clean and sanitize bathrooms: toilets, tubs, showers, mirrors",
  "Sweep, vacuum and mop floors",
  "Empty trash and replace liners",
  "General tidying and making beds",
];
const STANDARD_EXCLUDES = [
  "Moving heavy furniture",
  "Exterior windows",
  "Carpet or upholstery shampooing",
  "Mold remediation",
  "Post-construction cleanup",
  "Biohazard or hoarding-level cleanup",
  "Large-scale organization (available as an add-on by the hour)",
];

export const SERVICES = [
  {
    slug: "recurring",
    name: "Recurring Home Cleaning",
    kind: "recurring",
    short: "Weekly, every-two-weeks, or monthly visits that keep your home consistently clean.",
    description:
      "Our core service. Choose weekly, every two weeks, or monthly visits and we keep your home at the same standard every time. Recurring pricing assumes the home is maintained on schedule; a longer gap may need a reset clean first.",
    includes: STANDARD_INCLUDES,
    excludes: STANDARD_EXCLUDES,
    freqs: ["weekly", "biweekly", "monthly"],
    review: false,
    active: true,
  },
  {
    slug: "standard",
    name: "One-Time Standard Cleaning",
    kind: "standard",
    short: "A single top-to-bottom standard clean, ideal before guests or an event.",
    description: "A one-time visit covering our full standard checklist. Great for homes that are already in good shape.",
    includes: STANDARD_INCLUDES,
    excludes: STANDARD_EXCLUDES,
    freqs: ["one_time"],
    review: false,
    active: true,
  },
  {
    slug: "deep",
    name: "Deep Cleaning — Queen Reset",
    kind: "deep",
    short: "A detailed reset for homes that need extra attention or are starting a recurring plan.",
    description:
      "Everything in a standard clean plus the detail work: baseboards, door frames, light switches, cabinet fronts, built-up grime in kitchens and bathrooms. Recommended as the first visit before recurring service when a home hasn't been professionally cleaned recently.",
    includes: [...STANDARD_INCLUDES, "Baseboards, door frames and light switches", "Cabinet fronts and handles", "Detailed scrubbing of kitchen and bathroom buildup"],
    excludes: STANDARD_EXCLUDES,
    freqs: ["one_time"],
    review: false,
    active: true,
  },
  {
    slug: "move",
    name: "Move-In / Move-Out Cleaning",
    kind: "move",
    short: "An empty-home clean for moving day, inside cabinets and appliances by request.",
    description: "A thorough clean of an empty or nearly empty home before you move in or after you move out.",
    includes: [...STANDARD_INCLUDES, "Inside empty cabinets and drawers", "Baseboards and door frames"],
    excludes: STANDARD_EXCLUDES,
    freqs: ["one_time"],
    review: true,
    active: true,
  },
  {
    slug: "turnover",
    name: "Airbnb & Short-Term Rental Turnover",
    kind: "turnover",
    short: "Guest-ready turnovers between stays.",
    description: "Turnover cleaning between guest stays, with linen changes available as an add-on.",
    includes: [...STANDARD_INCLUDES, "Reset for the next guest"],
    excludes: [...STANDARD_EXCLUDES, "Restocking guest supplies unless arranged"],
    freqs: ["one_time"],
    review: true,
    active: false, // potential expansion — enable in Admin → Pricing & Services when ready
  },
  {
    slug: "custom",
    name: "Other / Custom Request",
    kind: "custom",
    short: "Something else in mind? Tell us and we'll prepare a custom quote.",
    description: "For anything that doesn't fit our standard services. We'll review your request and send a custom quote.",
    includes: [],
    excludes: [],
    freqs: ["one_time"],
    review: true,
    active: true,
  },
];

export const ADDONS = [
  ["inside-oven", "Inside oven", "Degrease and wipe the oven interior and racks."],
  ["inside-fridge", "Inside refrigerator", "Empty-shelf wipe-down of the refrigerator interior."],
  ["inside-cabinets", "Inside cabinets", "Wipe inside kitchen cabinets (please empty them first)."],
  ["interior-windows", "Interior windows", "Inside glass, sills and tracks, priced per window."],
  ["baseboards", "Baseboards", "Hand-wiped baseboards throughout the home."],
  ["pet-hair", "Pet hair removal", "Extra time for heavy pet hair on floors and furniture."],
  ["heavy-buildup", "Heavy grease or soap-scum buildup", "Extra scrubbing for buildup beyond normal maintenance."],
  ["ceiling-fans", "Ceiling fans", "Dust and wipe blades, priced per fan."],
  ["blinds", "Blinds", "Dust and wipe blinds, priced per room."],
  ["change-linens", "Change linens", "Strip and remake beds with your clean linens, priced per bed."],
  ["laundry", "Laundry (wash, dry & fold)", "Priced per load, done during the visit."],
  ["organization", "Organization", "Closets, pantry or drawers, priced per hour."],
] as const;

export const AREAS = [
  { name: "Las Vegas", zips: ["89101","89102","89103","89104","89106","89107","89108","89109","89110","89113","89115","89117","89118","89119","89120","89121","89122","89123","89128","89129","89130","89131","89139","89141","89142","89143","89146","89147","89148","89149","89156","89166","89169","89178","89179","89183"] },
  { name: "Summerlin", zips: ["89134","89135","89138","89144","89145"] },
  { name: "Henderson", zips: ["89002","89011","89012","89014","89015","89044","89052","89074"] },
  { name: "North Las Vegas", zips: ["89030","89031","89032","89081","89084","89085","89086"] },
];

async function main() {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    let i = 0;
    for (const s of SERVICES) {
      await sql`
        insert into services (slug, name, short_description, description, includes, excludes, kind, allowed_frequencies, requires_review, active, sort)
        values (${s.slug}, ${s.name}, ${s.short}, ${s.description}, ${s.includes}, ${s.excludes}, ${s.kind}, ${s.freqs}, ${s.review}, ${s.active}, ${i++})
        on conflict (slug) do nothing`;
    }
    i = 0;
    for (const [slug, name, description] of ADDONS) {
      await sql`insert into addons (slug, name, description, sort) values (${slug}, ${name}, ${description}, ${i++}) on conflict (slug) do nothing`;
    }
    i = 0;
    for (const a of AREAS) {
      await sql`insert into service_areas (name, zip_codes, sort) values (${a.name}, ${a.zips}, ${i++}) on conflict do nothing`;
    }
    const [existing] = await sql`select 1 from pricing_versions limit 1`;
    if (!existing) {
      await sql`insert into pricing_versions (version, status, rules, notes, published_at)
                values (1, 'published', ${sql.json(DEFAULT_RULES as never)}, 'Initial draft prices — review in Admin → Pricing & Services', now())`;
    }
    console.log("Base catalog, service areas and pricing are seeded.");
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
