import { actorOf, requireCap } from "@/lib/auth/session";
import { audit } from "@/lib/server/audit";
import { errorResponse, json } from "@/lib/server/http";
import { ImageError, MAX_UPLOAD_BYTES, storeSiteImage } from "@/lib/server/images";

/** Owner/admin upload of a website image. Returns the public address to save in settings. */
export async function POST(req: Request) {
  try {
    const user = await requireCap("settings.edit");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json({ error: "Choose an image to upload." }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "That image is too large. Please choose one under 10 MB." }, 413);
    const { id } = await storeSiteImage(Buffer.from(await file.arrayBuffer()), user.id);
    await audit(actorOf(user), "site_image.uploaded", "uploaded_image", id, {});
    return json({ ok: true, url: `/media/${id}.jpg` }, 201);
  } catch (e) {
    if (e instanceof ImageError) return json({ error: e.message }, 422);
    return errorResponse(e);
  }
}
