import { z } from "zod";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { ImageError, MAX_UPLOAD_BYTES, deleteUnattachedPhoto, storePropertyPhoto } from "@/lib/server/images";
import { clientIpHash, rateLimit } from "@/lib/server/security";

/** Customer property photos for a quote/booking request. Stored privately; only staff can view them. */
export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 64_000) return json({ error: "That photo is too large. Please choose one under 10 MB." }, 413);
    if (!(await rateLimit(`photo:${await clientIpHash()}`, 30, 3600))) return json({ error: "Too many uploads from this connection. Please try again later." }, 429);
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json({ error: "Choose a photo to upload." }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "That photo is too large. Please choose one under 10 MB." }, 413);
    const photo = await storePropertyPhoto(Buffer.from(await file.arrayBuffer()));
    return json({ ok: true, photo }, 201);
  } catch (e) {
    if (e instanceof ImageError) return json({ error: e.message }, 422);
    return errorResponse(e);
  }
}

const removeSchema = z.object({ id: z.string().uuid(), key: z.string().min(20).max(200) });

export async function DELETE(req: Request) {
  try {
    const parsed = removeSchema.safeParse(await readJson(req, 2_000).catch(() => null));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    await deleteUnattachedPhoto(parsed.data.id, parsed.data.key);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
