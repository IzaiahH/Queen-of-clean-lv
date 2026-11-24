import { loadImage } from "@/lib/server/images";

/** Public website images (e.g. the homepage hero). Customer photos are never served here. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = await loadImage(id.replace(/\.jpg$/, ""), "site_image");
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: { "Content-Type": img.content_type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
