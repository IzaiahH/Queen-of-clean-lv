import { DateTime } from "luxon";
import { requireCap } from "@/lib/auth/session";
import type { Capability } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/import/csv";
import { audit } from "@/lib/server/audit";
import { errorResponse, json } from "@/lib/server/http";
import { resolveRange } from "@/lib/server/ranges";
import { jobProfitRows, listExpenses, reportByArea, reportByCleaner, reportByCustomer, reportByMonth, reportByService } from "@/lib/server/reports";
import { loadSettings } from "@/lib/server/settings";

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(2));
const CAPS: Record<string, Capability> = {
  customers: "data.export", appointments: "data.export", expenses: "finance.view", jobs: "finance.view",
  "report-month": "reports.view", "report-service": "reports.view", "report-customer": "reports.view", "report-cleaner": "reports.view", "report-area": "reports.view",
};

function csvResponse(name: string, [headers, ...rows]: (string | number | null | undefined)[][]) {
  // UTF-8 BOM so Excel opens accented names correctly.
  return new Response("\uFEFF" + toCsv(headers.map(String), rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${DateTime.now().toFormat("yyyy-LL-dd")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    const cap = CAPS[type];
    if (!cap) return json({ error: "Unknown export" }, 404);
    const user = await requireCap(cap);
    const u = new URL(req.url);
    const settings = await loadSettings();
    const tz = settings.booking.timezone;
    const range = resolveRange({ range: u.searchParams.get("from") ? "custom" : "year", from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined }, tz);
    const fmt = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat("yyyy-LL-dd HH:mm");
    await audit({ id: user.id, label: user.full_name }, "data.export", "export", null, { type, from: range.fromISO, to: range.toISO });

    switch (type) {
      case "customers": {
        const rows = await db()<{ full_name: string; email: string | null; phone: string | null; status: string; preferred_contact: string; address_line1: string | null; unit: string | null; city: string | null; zip: string | null; bedrooms: number | null; full_baths: number | null; sqft: number | null; customer_since: string | null; preferences: string; source: string; created_at: Date }[]>`
          select c.full_name, c.email, c.phone, c.status, c.preferred_contact, p.address_line1, p.unit, p.city, p.zip, p.bedrooms, p.full_baths, p.sqft, c.customer_since::text, c.preferences, c.source, c.created_at
            from customers c left join lateral (select * from properties p where p.customer_id = c.id order by is_primary desc, created_at limit 1) p on true
           where c.merged_into_id is null order by c.full_name`;
        // Access instructions and private notes are deliberately left out of exports.
        return csvResponse("customers", [
          ["Name", "Email", "Phone", "Status", "Preferred contact", "Address", "Unit", "City", "ZIP", "Bedrooms", "Full baths", "Sq ft", "Customer since", "Preferences", "Source", "Created"],
          ...rows.map((r) => [r.full_name, r.email, r.phone, r.status, r.preferred_contact, r.address_line1, r.unit, r.city, r.zip, r.bedrooms, r.full_baths, r.sqft, r.customer_since, r.preferences, r.source, fmt(r.created_at)]),
        ]);
      }
      case "appointments": {
        const rows = await db()<{ reference: string; starts_at: Date; ends_at: Date; status: string; customer: string; service: string; frequency: string; agreed_price_cents: number; revenue_cents: number | null; cleaners: string | null; address: string; payment_status: string; source: string }[]>`
          select a.reference, a.starts_at, a.ends_at, a.status, c.full_name as customer, coalesce(s.name, a.service_slug) as service, a.frequency, a.agreed_price_cents,
                 j.revenue_cents, (select string_agg(cl.full_name, '; ') from appointment_assignments x join cleaners cl on cl.id = x.cleaner_id where x.appointment_id = a.id) as cleaners,
                 concat_ws(', ', p.address_line1, p.city, p.zip) as address, a.payment_status, a.source
            from appointments a join customers c on c.id = a.customer_id join properties p on p.id = a.property_id
            left join services s on s.slug = a.service_slug left join job_records j on j.appointment_id = a.id
           where a.starts_at >= ${range.from} and a.starts_at < ${range.to} order by a.starts_at`;
        return csvResponse("appointments", [
          ["Reference", "Start", "End", "Status", "Customer", "Service", "Frequency", "Agreed price", "Completed revenue", "Cleaners", "Address", "Payment", "Source"],
          ...rows.map((r) => [r.reference, fmt(r.starts_at), fmt(r.ends_at), r.status, r.customer, r.service, r.frequency, dollars(r.agreed_price_cents), dollars(r.revenue_cents), r.cleaners, r.address, r.payment_status, r.source]),
        ]);
      }
      case "expenses": {
        const rows = await listExpenses(range);
        return csvResponse("expenses", [["Date", "Category", "Amount", "Description", "Estimate", "Job"], ...rows.map((r) => [r.spent_on, r.category, dollars(r.amount_cents), r.description, r.is_estimate ? "yes" : "no", r.appointment_ref])]);
      }
      case "jobs": {
        const rows = await jobProfitRows(range);
        return csvResponse("job-profit", [
          ["Date", "Customer", "Service", "Area", "Cleaners", "Revenue", "Labor", "Supplies", "Other costs", "Profit", "Margin %", "Minutes", "Paid", "Payment status"],
          ...rows.map((r) => [fmt(r.starts_at), r.customer, r.service, r.area, r.cleaners, dollars(r.revenue_cents), dollars(r.labor_cents), dollars(r.supplies_cents), dollars(r.other_cents), dollars(r.profit_cents), r.margin_pct, r.minutes, dollars(r.paid_cents), r.payment_status]),
        ]);
      }
      case "report-month": {
        const rows = await reportByMonth(range, tz);
        return csvResponse("report-by-month", [
          ["Month", "Completed jobs", "Completed revenue", "Booked", "Labor", "Job costs", "Expenses", "Operating profit", "Cancelled/no-show", "Appointments"],
          ...rows.map((r) => [r.key, r.jobs, dollars(r.revenue_cents), dollars(r.booked_cents), dollars(r.labor_cents), dollars(r.job_costs_cents), dollars(r.expenses_cents), dollars(r.operating_profit_cents), r.cancellations, r.appointments]),
        ]);
      }
      case "report-cleaner": {
        const rows = await reportByCleaner(range);
        return csvResponse("report-by-cleaner", [["Cleaner", "Jobs", "Hours", "Pay recorded", "Revenue share", "No-shows"], ...rows.map((r) => [r.name, r.jobs, (r.minutes / 60).toFixed(2), dollars(r.pay_cents), dollars(r.revenue_share_cents), r.no_shows])]);
      }
      default: {
        const rows = type === "report-service" ? await reportByService(range) : type === "report-area" ? await reportByArea(range) : await reportByCustomer(range);
        return csvResponse(type, [["Group", "Jobs", "Revenue", "Labor", "Supplies", "Other", "Profit", "Hours"], ...rows.map((r) => [r.key, r.jobs, dollars(r.revenue_cents), dollars(r.labor_cents), dollars(r.supplies_cents), dollars(r.other_cents), dollars(r.profit_cents), (r.minutes / 60).toFixed(2)])]);
      }
    }
  } catch (e) {
    return errorResponse(e);
  }
}
