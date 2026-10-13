import { errorResponse, json, readJson } from "@/lib/server/http";
import { priceFromProperty } from "@/lib/server/quotes";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { propertyInputSchema, zodErrors } from "@/lib/validation/booking";

/** Public estimate. Returns only customer-safe fields — never wages, margins or internal notes. */
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`estimate:${await clientIpHash()}`, 120, 600))) return json({ error: "Too many requests. Please wait a few minutes." }, 429);
    const parsed = propertyInputSchema.safeParse(await readJson(req).catch(() => null));
    if (!parsed.success) return json({ error: "Please check your home details.", fields: zodErrors(parsed.error) }, 422);
    const priced = await priceFromProperty(parsed.data);
    if ("error" in priced) return json({ error: priced.error }, 422);
    const r = priced.result;
    return json({
      ok: true,
      estimate: {
        mode: r.mode,
        lines: r.lines.map((l) => ({ label: l.label, amount_cents: l.amount_cents, kind: l.kind })),
        total_cents: r.total_cents,
        recurring_per_visit_cents: r.recurring_per_visit_cents,
        estimated_minutes: r.estimated_minutes,
        requires_review: r.requires_review,
        review_reasons: r.review_reasons,
        notes: r.notes,
        area_name: priced.area?.name ?? null,
        area_message: priced.areaMessage,
        pricing_version: priced.version,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
