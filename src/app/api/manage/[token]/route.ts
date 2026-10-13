import { customerRequest } from "@/lib/server/appointments";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { clientIpHash, rateLimit, sha256 } from "@/lib/server/security";
import { customerRequestSchema } from "@/lib/validation/booking";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!(await rateLimit(`manage:${await clientIpHash()}`, 10, 3600))) return json({ error: "Too many requests. Please contact us directly." }, 429);
    const parsed = customerRequestSchema.safeParse(await readJson(req).catch(() => null));
    if (!parsed.success) return json({ error: "Invalid request" }, 422);
    const r = await customerRequest(sha256(token), parsed.data.kind, parsed.data.requested_start ?? null, parsed.data.message);
    if (!r.ok) return json({ error: r.error }, 409);
    return json({ ok: true, message: r.message });
  } catch (e) {
    return errorResponse(e);
  }
}
