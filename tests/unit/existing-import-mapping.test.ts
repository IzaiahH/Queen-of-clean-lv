import { describe, expect, it } from "vitest";
import { mapRecord, sourceFileSchema, sourceRecordSchema } from "@/lib/import/existing-customers";

const rec = (o: Record<string, unknown>) => sourceRecordSchema.parse({ ref: "x-01", name: "Test", frequency: "monthly", rate: 315, ...o });

describe("existing-customer record mapping", () => {
  it("maps .5 bathrooms to one half bath and rejects other fractions", () => {
    expect(mapRecord(rec({ bathrooms: 3.5 }))).toMatchObject({ full_baths: 3, half_baths: 1 });
    expect(mapRecord(rec({ bathrooms: 3 }))).toMatchObject({ full_baths: 3, half_baths: 0 });
    expect(mapRecord(rec({ bathrooms: 2.25 }))).toHaveProperty("error");
  });
  it("keeps a square-footage range as a note and never picks a number from it", () => {
    const m = mapRecord(rec({ sqft: { min: 2200, max: 2400 } }));
    expect(m).toMatchObject({ sqft: null });
    expect("sqftNote" in m && m.sqftNote).toBe("Approximately 2,200–2,400 sq ft");
  });
  it("leaves unknown details blank", () => {
    expect(mapRecord(rec({}))).toMatchObject({ full_baths: null, half_baths: 0, sqft: null, sqftNote: "" });
  });
  it("accepts rates only in whole cents", () => {
    expect(sourceRecordSchema.safeParse({ ref: "x-01", name: "T", frequency: "monthly", rate: 249.99 }).success).toBe(true);
    expect(sourceRecordSchema.safeParse({ ref: "x-01", name: "T", frequency: "monthly", rate: 249.999 }).success).toBe(false);
    expect(sourceRecordSchema.safeParse({ ref: "x-01", name: "T", frequency: "monthly", rate: -5 }).success).toBe(false);
  });
  it("maps many full + 1 half bathrooms with a size range, without inventing a size", () => {
    const m = mapRecord(rec({ bedrooms: 6, bathrooms: 5.5, sqft: { min: 2750, max: 3050 } }));
    expect(m).toEqual({ full_baths: 5, half_baths: 1, sqft: null, sqftNote: "Approximately 2,750–3,050 sq ft" });
  });
  it("only accepts per-visit rates and well-formed confirmed groups", () => {
    const file = { source: "Test records", rate_basis: "per_visit", customers: [{}] };
    expect(sourceFileSchema.safeParse(file).success).toBe(true);
    expect(sourceFileSchema.safeParse({ ...file, rate_basis: "per_month" }).success).toBe(false);
    expect(sourceFileSchema.safeParse({ ...file, rate_basis: undefined }).success).toBe(false);
    expect(sourceFileSchema.safeParse({ ...file, confirmed_separate: [["a", "b"]] }).success).toBe(true);
    expect(sourceFileSchema.safeParse({ ...file, confirmed_separate: [["a"]] }).success).toBe(false);
  });
});
