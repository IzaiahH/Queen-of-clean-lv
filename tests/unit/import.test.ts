import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { parseCsv, toCsv } from "@/lib/import/csv";
import { guessMapping, reviewRows, summarize } from "@/lib/import/review";

// Synthetic sample shaped like the owner's tracker (no real customer data).
const CSV = `Customer,Area,Bedrooms,Bathrooms,Sq Ft,Frequency,Current Price,New Price,Cleaning Time (hrs),Cleaner,Cleaner Pay,Supplies,Profit,Monthly Revenue,Next Cleaning,Notes
Sample Alpha,Summerlin,3,2.5,"1,850",Biweekly,$160,$185,3,Sample Cleaner,$75,$8,#VALUE!,$370,11/18/2026,gate code by text
Sample Beta,Henderson,4,3,2400,every 2 weeks,$170,,3.5,,,,,,,
Sample Gamma,Somewhere Else,big house,2,~2000,whenever,call for price,#VALUE!,,,,,,,Nov 20,
,Summerlin,2,2,1200,Monthly,$210,,,,,,,,,
Sample Beta,Henderson,4,3,2400,Biweekly,$170,,,,,,,,,duplicate row`;

describe("CSV", () => {
  it("parses quoted fields and escapes formula injection on export", () => {
    const rows = parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n');
    expect(rows).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
    expect(toCsv(["x"], [["=HYPERLINK(1)"], ["-15.50"]])).toBe("x\r\n'=HYPERLINK(1)\r\n-15.50\r\n");
  });
});

describe("import review", () => {
  const [headers, ...rows] = parseCsv(CSV);
  const mapping = guessMapping(headers);
  const reviewed = reviewRows(headers, rows, mapping, {
    areas: ["Summerlin", "Henderson", "Las Vegas"],
    existing: [{ id: "existing-1", full_name: "Sample Alpha", email: null, phone: null }],
    today: DateTime.fromISO("2026-10-12"),
  });

  it("guesses the tracker's columns and ignores derived ones", () => {
    expect(mapping).toEqual(["full_name", "area", "bedrooms", "bathrooms", "sqft", "frequency", "current_price", "new_price", "cleaning_hours", "cleaner", "cleaner_pay", "supplies", "ignore", "ignore", "next_cleaning", "notes"]);
  });

  it("parses clean values and flags formula errors without importing them", () => {
    const a = reviewed[0];
    expect(a.parsed).toMatchObject({ full_name: "Sample Alpha", area_name: "Summerlin", bedrooms: 3, full_baths: 2, half_baths: 1, sqft: 1850, frequency: "biweekly", agreed_price_cents: 18500, estimated_minutes: 180, next_cleaning: "2026-11-18" });
    expect(a.issues.some((i) => /differ/.test(i.message))).toBe(true);
    expect(a.duplicates[0].id).toBe("existing-1");
    expect(a.decision).toBe("skip"); // possible duplicate → needs a human decision
  });

  it("keeps ambiguous values as notes instead of guessing", () => {
    const g = reviewed[2];
    expect(g.parsed.bedrooms).toBeNull();
    expect(g.parsed.frequency).toBeNull();
    expect(g.parsed.agreed_price_cents).toBeNull();
    expect(g.parsed.sqft).toBe(2000);
    expect(g.parsed.notes).toEqual(expect.arrayContaining(["Area: Somewhere Else", "Bedrooms: big house", "Frequency: whenever", "Current Price: call for price"]));
    expect(g.issues.some((i) => /formula error/.test(i.message))).toBe(true);
    expect(g.parsed.next_cleaning).toBe("2026-11-20");
  });

  it("rejects rows without a name and flags in-file duplicates", () => {
    expect(reviewed[3].issues.some((i) => i.level === "error")).toBe(true);
    expect(reviewed[4].duplicates.some((d) => d.id === "row-2")).toBe(true);
    expect(summarize(reviewed)).toMatchObject({ total: 5, to_import: 2, with_errors: 1, possible_duplicates: 2 });
  });
});
