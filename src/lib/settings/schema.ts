import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const dayHours = z.object({ open: hhmm, close: hhmm }).nullable();

export const settingsSchemas = {
  business: z.object({
    name: z.string().min(1).max(80),
    tagline: z.string().max(140),
    description: z.string().max(1200),
    phone: z.string().max(30),
    email: z.string().max(120),
    hours_text: z.string().max(200),
    response_time_text: z.string().max(200),
    strengths: z.array(z.object({ title: z.string().max(60), body: z.string().max(300) })).max(8),
    faqs: z.array(z.object({ q: z.string().max(200), a: z.string().max(1200) })).max(20),
    logo_data_url: z.string().max(400_000).nullable(),
  }),
  booking: z.object({
    timezone: z.string().min(1),
    operating_hours: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), dayHours),
    slot_interval_minutes: z.number().int().min(15).max(240),
    lead_time_hours: z.number().int().min(0).max(24 * 30),
    horizon_days: z.number().int().min(7).max(180),
    travel_buffer_minutes: z.number().int().min(0).max(180),
    max_jobs_per_day: z.number().int().min(1).max(50),
    auto_confirm: z.object({
      enabled: z.boolean(),
      max_estimate_cents: z.number().int().min(0),
      returning_customers_only: z.boolean(),
    }),
    quote_expiration_days: z.number().int().min(1).max(180),
    allow_unknown_areas: z.boolean(), // accept addresses outside configured areas for manual review
  }),
  policies: z.object({
    cancellation_notice_hours: z.number().int().min(0).max(168),
    cancellation_policy: z.string().max(3000),
    reschedule_policy: z.string().max(3000),
    privacy_policy: z.string().max(20000),
    terms_of_service: z.string().max(20000),
    policies_reviewed: z.boolean(),
  }),
  recurring: z.object({
    horizon_weeks: z.number().int().min(2).max(26),
    /** Checklist shown when a job is completed (cleaners tick what was done). */
    default_checklist: z.array(z.string().min(1).max(200)).max(60),
  }),
  notifications: z.object({
    admin_emails: z.array(z.string().email()).max(5),
    customer_emails_enabled: z.boolean(),
    admin_new_request_enabled: z.boolean(),
    reminder_hours_before: z.number().int().min(0).max(168), // 0 = off
    followup_enabled: z.boolean(),
    sms_enabled: z.boolean(),
  }),
  email_templates: z.record(
    z.string(),
    z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }),
  ),
  privacy: z.object({
    retention_years: z.number().int().min(1).max(20),
    contact_message_retention_days: z.number().int().min(30).max(3650),
  }),
};

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };

const weekdays = { open: "08:00", close: "17:00" };

export const DEFAULT_SETTINGS: Settings = {
  business: {
    name: "Queen of Clean LV",
    tagline: "Luxury home cleaning in Las Vegas",
    description:
      "Queen of Clean LV is a residential cleaning business serving Las Vegas homes. We focus on consistent recurring care, thorough resets, and careful attention to detail.",
    phone: "",
    email: "",
    hours_text: "Monday – Friday, 8:00 AM – 5:00 PM",
    response_time_text: "We review every request and reply within one business day.",
    strengths: [
      { title: "Owner-led service", body: "The owner reviews every request and plans each visit around your home." },
      { title: "Consistent recurring care", body: "Weekly, biweekly, and monthly schedules keep your home at the same standard visit after visit." },
      { title: "Clear, upfront estimates", body: "See how your estimate is calculated before you book. No surprise line items." },
      { title: "Your priorities first", body: "Tell us what matters most and we plan each visit around it." },
    ],
    faqs: [
      { q: "Is the price I see final?", a: "It's an estimate based on what you tell us. If your home's condition or the scope is different from what was submitted, we'll discuss any change with you before we start." },
      { q: "When is my appointment confirmed?", a: "After you request a time, we review it and confirm by email. Your request shows as Pending Review until then." },
      { q: "Do I need to be home?", a: "No. Many clients share entry instructions, which only our team can see. Just let us know in the booking form." },
      { q: "Do you bring supplies?", a: "Yes, we bring our own supplies and equipment. Let us know if you prefer we use specific products." },
      { q: "How do I cancel or reschedule?", a: "Use the link in your confirmation email, or contact us directly. Please give as much notice as possible." },
    ],
    logo_data_url: null,
  },
  booking: {
    timezone: "America/Los_Angeles",
    operating_hours: { "1": weekdays, "2": weekdays, "3": weekdays, "4": weekdays, "5": weekdays, "6": null, "7": null },
    slot_interval_minutes: 30,
    lead_time_hours: 24,
    horizon_days: 60,
    travel_buffer_minutes: 30,
    max_jobs_per_day: 4,
    auto_confirm: { enabled: false, max_estimate_cents: 30000, returning_customers_only: true },
    quote_expiration_days: 30,
    allow_unknown_areas: true,
  },
  policies: {
    cancellation_notice_hours: 24,
    cancellation_policy:
      "Please give at least 24 hours' notice to cancel or reschedule. Late cancellations, same-day changes, or being unable to access the home at the scheduled time may be subject to a fee, as described in your service agreement.",
    reschedule_policy:
      "Reschedule requests are reviewed by our team and are confirmed only once we reply. Recurring clients who frequently reschedule may lose their regular time slot.",
    privacy_policy:
      "We collect only the information needed to quote, schedule, and perform your cleaning: your name, contact details, service address, home details, and any access instructions you choose to share. Access instructions are visible only to our team members assigned to your home. We never sell your information. Booking emails are sent through our email provider. You can ask us to update or delete your information at any time by contacting us.",
    terms_of_service:
      "Estimates shown on this website are based on the details you provide and are not final until confirmed by Queen of Clean LV. A booking request is not a confirmed appointment until we confirm it in writing. Prices may change if the condition or scope of the work differs from the submitted details; we'll discuss any change before starting. Online payment is not collected through this website.",
    policies_reviewed: false,
  },
  recurring: {
    horizon_weeks: 8,
    default_checklist: [
      "Kitchen counters, sink and appliance fronts wiped",
      "Stovetop and microwave cleaned",
      "Bathrooms: toilet, tub/shower, sink and mirrors",
      "Dusting of reachable surfaces",
      "Floors vacuumed and mopped",
      "Beds made / linens changed if requested",
      "Trash emptied",
      "Add-ons completed",
      "Final walkthrough done",
    ],
  },
  notifications: {
    admin_emails: [],
    customer_emails_enabled: true,
    admin_new_request_enabled: true,
    reminder_hours_before: 24,
    followup_enabled: false,
    sms_enabled: false,
  },
  email_templates: {
    request_received: {
      subject: "We received your cleaning request ({{reference}})",
      body: "Hi {{first_name}},\n\nThank you for choosing {{business_name}}. We received your request for {{service}} on {{date_time}}.\n\nStatus: Pending review. Your appointment is not confirmed yet — we'll email you once we've reviewed it. {{response_time}}\n\nEstimate: {{estimate}}\n\nView or change your request: {{manage_url}}\n\n{{business_name}}",
    },
    booking_confirmed: {
      subject: "Your cleaning is confirmed ({{reference}})",
      body: "Hi {{first_name}},\n\nGood news — your {{service}} is confirmed for {{date_time}}.\n\nAgreed price: {{price}}\n\nNeed to make a change? {{manage_url}}\n\n{{cancellation_policy}}\n\n{{business_name}}",
    },
    booking_declined: {
      subject: "About your cleaning request ({{reference}})",
      body: "Hi {{first_name}},\n\nUnfortunately we can't take the {{service}} request for {{date_time}}. {{message}}\n\nPlease reply to this email or request another time on our website.\n\n{{business_name}}",
    },
    booking_rescheduled: {
      subject: "Your cleaning time has changed ({{reference}})",
      body: "Hi {{first_name}},\n\nYour {{service}} is now scheduled for {{date_time}} (status: {{status}}).\n\nDetails: {{manage_url}}\n\n{{business_name}}",
    },
    booking_cancelled: {
      subject: "Your cleaning has been cancelled ({{reference}})",
      body: "Hi {{first_name}},\n\nYour {{service}} on {{date_time}} has been cancelled. {{message}}\n\n{{business_name}}",
    },
    reminder: {
      subject: "Reminder: cleaning on {{date}}",
      body: "Hi {{first_name}},\n\nThis is a reminder of your {{service}} on {{date_time}}.\n\nNeed to make a change? {{manage_url}}\n\n{{business_name}}",
    },
    quote: {
      subject: "Your cleaning estimate from {{business_name}} ({{reference}})",
      body: "Hi {{first_name}},\n\nHere is your estimate for {{service}}: {{estimate}}.\n\nReview and accept it here: {{quote_url}}\nThis estimate is valid until {{expires}}.\n\n{{business_name}}",
    },
    followup: {
      subject: "Thank you from {{business_name}}",
      body: "Hi {{first_name}},\n\nThank you for letting us care for your home. If anything wasn't perfect, just reply and let us know.\n\n{{business_name}}",
    },
    admin_new_request: {
      subject: "New booking request {{reference}}",
      body: "New request: {{service}} on {{date_time}}.\nCustomer: {{customer_name}}\nEstimate: {{estimate}}\nReview reasons: {{review_reasons}}\n\nOpen in admin: {{admin_url}}",
    },
    contact_message: {
      subject: "Website message from {{name}}",
      body: "{{name}} ({{email}}, {{phone}}) wrote:\n\n{{message}}\n\nView messages: {{admin_url}}",
    },
    customer_request: {
      subject: "Customer {{kind}} request for {{reference}}",
      body: "{{customer_name}} asked to {{kind}} their {{service}} on {{date_time}}.\nMessage: {{message}}\n\nOpen in admin: {{admin_url}}",
    },
  },
  privacy: { retention_years: 7, contact_message_retention_days: 365 },
};
