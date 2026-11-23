import "server-only";
import sharp from "sharp";
import { db, type Tx } from "@/lib/db";
import { newToken, sha256 } from "./security";

/** Largest file accepted from a browser. Phones send large originals; we shrink them on the server. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Photos a customer can attach to one quote or booking request. */
export const MAX_PROPERTY_PHOTOS = 6;
const MAX_STORED_BYTES = 3_000_000;

export class ImageError extends Error {}

/** Checks the file's first bytes, so a renamed non-image can't get through on its extension. */
function sniff(buf: Buffer): "jpeg" | "png" | "webp" | "heif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|hevc|mif1|msf1|avif)$/.test(buf.toString("ascii", 8, 12))) return "heif";
  return null;
}

/**
 * Decodes and re-encodes an image: applies the phone's rotation, limits it to 2000px,
 * and drops all metadata (EXIF, including GPS location). Anything that doesn't decode is rejected.
 */
export async function normalizeImage(input: Buffer, maxEdge = 2000): Promise<{ data: Buffer; width: number; height: number }> {
  if (input.length === 0) throw new ImageError("That file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("That photo is too large. Please choose one under 10 MB.");
  const kind = sniff(input);
  if (!kind) throw new ImageError("Please upload a JPG, PNG, WebP or iPhone photo.");
  try {
    let quality = 80;
    for (;;) {
      const { data, info } = await sharp(input, { limitInputPixels: 60_000_000, failOn: "error" })
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_STORED_BYTES || quality <= 50) {
        if (data.length > MAX_STORED_BYTES) throw new ImageError("That photo is too detailed to store. Please try another.");
        return { data, width: info.width, height: info.height };
      }
      quality -= 15;
    }
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError(kind === "heif" ? "We couldn't read that iPhone photo. Please choose it again, or upload a screenshot of it." : "We couldn't read that image. Please try a different photo.");
  }
}

/** Stores a customer's property photo, not yet linked to anything. Returns the key the browser needs to attach or remove it. */
export async function storePropertyPhoto(input: Buffer): Promise<{ id: string; key: string; width: number; height: number }> {
  const img = await normalizeImage(input);
  const key = newToken();
  const [row] = await db()<{ id: string }[]>`
    insert into uploaded_images (purpose, content_type, bytes, size_bytes, width, height, upload_key_hash)
    values ('property_photo', 'image/jpeg', ${img.data}, ${img.data.length}, ${img.width}, ${img.height}, ${sha256(key)})
    returning id`;
  return { id: row.id, key, width: img.width, height: img.height };
}

/** Removes a photo the customer uploaded and then took out, before submitting. Attached photos can't be removed this way. */
export async function deleteUnattachedPhoto(id: string, key: string): Promise<boolean> {
  const rows = await db()`
    delete from uploaded_images where id = ${id} and purpose = 'property_photo' and attached_at is null and upload_key_hash = ${sha256(key)}`;
  return rows.count > 0;
}

/**
 * Links a submission's photos to its quote, appointment and customer. Only photos whose key matches
 * and that aren't already attached are linked, so nobody can claim someone else's upload. Returns how many were linked.
 */
export async function attachPropertyPhotos(
  tx: Tx,
  photos: { id: string; key: string }[],
  link: { quoteId: string; appointmentId: string | null; customerId: string },
): Promise<number> {
  let n = 0;
  for (const p of photos.slice(0, MAX_PROPERTY_PHOTOS)) {
    const rows = await tx`
      update uploaded_images
         set quote_id = ${link.quoteId}, appointment_id = ${link.appointmentId}, customer_id = ${link.customerId}, attached_at = now()
       where id = ${p.id} and purpose = 'property_photo' and attached_at is null and upload_key_hash = ${sha256(p.key)}`;
    n += rows.count;
  }
  return n;
}

export async function storeSiteImage(input: Buffer, profileId: string): Promise<{ id: string }> {
  const img = await normalizeImage(input, 2400);
  const [row] = await db()<{ id: string }[]>`
    insert into uploaded_images (purpose, content_type, bytes, size_bytes, width, height, uploaded_by)
    values ('site_image', 'image/jpeg', ${img.data}, ${img.data.length}, ${img.width}, ${img.height}, ${profileId})
    returning id`;
  return row;
}

export async function loadImage(id: string, purpose?: "site_image" | "property_photo") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db()<{ bytes: Buffer; content_type: string; purpose: string }[]>`
    select bytes, content_type, purpose from uploaded_images where id = ${id}`;
  if (!row || (purpose && row.purpose !== purpose)) return null;
  return row;
}

export type PhotoSummary = { id: string; width: number; height: number; created_at: Date };

export async function photosFor(where: { quoteId?: string; appointmentId?: string; customerId?: string }): Promise<PhotoSummary[]> {
  const sql = db();
  if (where.appointmentId)
    return sql<PhotoSummary[]>`select id, width, height, created_at from uploaded_images where purpose = 'property_photo' and (appointment_id = ${where.appointmentId} or quote_id = (select quote_id from appointments where id = ${where.appointmentId})) order by created_at`;
  if (where.quoteId)
    return sql<PhotoSummary[]>`select id, width, height, created_at from uploaded_images where purpose = 'property_photo' and quote_id = ${where.quoteId} order by created_at`;
  if (where.customerId)
    return sql<PhotoSummary[]>`select id, width, height, created_at from uploaded_images where purpose = 'property_photo' and customer_id = ${where.customerId} order by created_at desc limit 60`;
  return [];
}

/** Daily cleanup: photos uploaded but never submitted with a request. */
export async function purgeAbandonedPhotos(): Promise<number> {
  const rows = await db()`delete from uploaded_images where purpose = 'property_photo' and attached_at is null and created_at < now() - interval '24 hours'`;
  return rows.count;
}
