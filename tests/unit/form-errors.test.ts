import { describe, expect, it } from "vitest";
import { zodToRes } from "@/app/admin/actions/guard";
import { propertyEditSchema } from "@/lib/server/customers";

const property = { label: "Home", address_line1: "", unit: "", city: "", state: "NV", zip: "", property_type: "house", bedrooms: 3, full_baths: 2, half_baths: 0, sqft: null, pets: "", condition: null, access_instructions: "", special_requirements: "", is_primary: true };

describe("form validation errors", () => {
  it("names each missing field in plain words instead of a raw validation message", () => {
    const r = propertyEditSchema.safeParse({ ...property, label: " ", zip: "123" });
    expect(r.success).toBe(false);
    const res = zodToRes(r.error!);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Please fill in the fields outlined in red.");
    expect(res.fields).toEqual({ label: "Give this home a name, e.g. Home", city: "Enter the city", zip: "ZIP must be 5 digits" });
    expect(JSON.stringify(res)).not.toMatch(/Too small|expected string/);
  });
  it("accepts an imported home once the city is filled in, even without a street address", () => {
    expect(propertyEditSchema.safeParse({ ...property, city: "Las Vegas" }).success).toBe(true);
  });
});
