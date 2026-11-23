import { describe, expect, it } from "vitest";
import { mapRecord, sourceRecordSchema } from "@/lib/import/existing-customers";

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
});
