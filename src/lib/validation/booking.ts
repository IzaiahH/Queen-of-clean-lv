import { z } from "zod";
import { CONDITIONS, FREQUENCIES } from "@/lib/pricing/rules";

/** Shared by the wizard (client-side hints) and the API (authoritative server-side validation). */

export const propertyInputSchema = z.object({
  service: z.string().min(1, "Choose a service").max(40),
  frequency: z.enum(FREQUENCIES),
  property_type: z.enum(["house", "townhome", "condo", "apartment", "other"]),
  bedrooms: z.number().int().min(0).max(20),
  full_baths: z.number().int().min(0).max(20),
  half_baths: z.number().int().min(0).max(20),
  sqft: z.number().int().min(100, "Enter a size of at least 100 sq ft").max(50000).nullable(),
  condition: z.enum(CONDITIONS).nullable(),
  pets: z.number().int().min(0).max(20),
  addons: z.array(z.object({ slug: z.string().min(1).max(60), quantity: z.number().int().min(1).max(50) })).max(30),
  zip: z.string().trim().regex(/^\d{5}$/, "Enter a 5-digit ZIP code"),
});
export type PropertyInput = z.infer<typeof propertyInputSchema>;

const trimmed = (max: number) => z.string().trim().max(max);

export const bookingRequestSchema = z
  .object({
    idempotency_key: z.string().uuid(),
    mode: z.enum(["book", "quote_only"]),
    property: propertyInputSchema.extend({
      address_line1: trimmed(120).min(3, "Enter the street address"),
      unit: trimmed(20).optional().default(""),
      city: trimmed(60).min(2, "Enter the city"),
      recently_cleaned: z.enum(["yes", "no", "not_sure"]),
      pet_details: trimmed(300).optional().default(""),
      occupancy: trimmed(300).optional().default(""),
      special_requests: trimmed(1000).optional().default(""),
    }),
    schedule: z.object({
      slot_start: z.string().datetime({ offset: true }).nullable(),
      preferred_window: z.enum(["morning", "afternoon", "flexible"]).default("flexible"),
      preferences: trimmed(500).optional().default(""),
      wants_recurring: z.boolean().default(false),
    }),
    contact: z.object({
      full_name: trimmed(100).min(2, "Enter your full name"),
      email: z.string().trim().toLowerCase().email("Enter a valid email address").max(160),
      phone: z
        .string()
        .trim()
        .refine((v) => {
          const d = v.replace(/\D/g, "");
          return d.length === 10 || (d.length === 11 && d.startsWith("1"));
        }, "Enter a 10-digit US phone number"),
      preferred_contact: z.enum(["email", "phone", "text"]),
      access_instructions: trimmed(1000).optional().default(""),
      notes: trimmed(1000).optional().default(""),
      consent: z.literal(true, { message: "Please agree so we can contact you about this booking" }),
    }),
    /** Honeypot: real people never see or fill this field. */
    website: z.string().max(0).optional().default(""),
    /** When the form was opened (ms). Submissions faster than a human could type are rejected. */
    started_at: z.number().int(),
  })
  .refine((v) => v.mode === "quote_only" || v.schedule.slot_start !== null, {
    path: ["schedule", "slot_start"],
    message: "Choose an appointment time",
  });
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const contactMessageSchema = z.object({
  name: trimmed(100).min(2, "Enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(160),
  phone: trimmed(30).optional().default(""),
  message: trimmed(3000).min(10, "Tell us a little more (at least 10 characters)"),
  website: z.string().max(0).optional().default(""),
  started_at: z.number().int(),
});

export const customerRequestSchema = z.object({
  kind: z.enum(["cancel", "reschedule"]),
  requested_start: z.string().datetime({ offset: true }).nullable().optional(),
  message: trimmed(1000).optional().default(""),
});

export function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
