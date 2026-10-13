import { submitBookingRequest } from "@/lib/server/booking";
import { errorResponse, json, readJson, tooFast } from "@/lib/server/http";
import { clientIpHash, rateLimit } from "@/lib/server/security";
import { bookingRequestSchema, zodErrors } from "@/lib/validation/booking";

export async function POST(req: Request) {
  try {
    const parsed = bookingRequestSchema.safeParse(await readJson(req).catch(() => null));
    if (!parsed.success) return json({ error: "Please check the highlighted fields.", fields: zodErrors(parsed.error) }, 422);
    const r = parsed.data;
    if (r.website) return json({ error: "We couldn't accept this submission. Please call or email us." }, 400);
    if (tooFast(r.started_at, 8000)) return json({ error: "That was quick! Please check your details, then press submit again." }, 400);
    if (!(await rateLimit(`booking:${await clientIpHash()}`, 8, 3600))) return json({ error: "Too many requests from this connection. Please call or email us." }, 429);
    const out = await submitBookingRequest(r);
    if (!out.ok) return json({ error: out.error, slot_taken: out.slot_taken ?? false, fields: out.field ? { [out.field]: out.error } : undefined }, out.slot_taken ? 409 : 422);
    return json(out, out.duplicate ? 200 : 201);
  } catch (e) {
    return errorResponse(e);
  }
}
