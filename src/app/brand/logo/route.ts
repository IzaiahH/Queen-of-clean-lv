import { loadSettings } from "@/lib/server/settings";

/** Serves the uploaded logo (stored as a data URL in settings) as a cacheable image. Raster formats only. */
export async function GET() {
  const url = (await loadSettings()).business.logo_data_url;
  const m = url?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
