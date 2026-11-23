import { requireCap } from "@/lib/auth/session";
import { errorResponse, json } from "@/lib/server/http";
import { loadImage } from "@/lib/server/images";

/** Staff-only image view (customer property photos). Never cached by shared caches. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCap("quotes.view");
    const { id } = await params;
    const img = await loadImage(id);
    if (!img) return json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(img.bytes), {
      headers: {
        "Content-Type": img.content_type,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
