import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { submitBookingRequest } from "@/lib/server/booking";
import { ImageError, deleteUnattachedPhoto, normalizeImage, purgeAbandonedPhotos, storePropertyPhoto } from "@/lib/server/images";
import { bookingRequest, makeCleaner, resetData, weekdayAt } from "./helpers";

/** A 3000×2000 JPEG carrying EXIF (camera make and a GPS position). */
async function phonePhoto() {
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 220, g: 200, b: 160 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "SyntheticPhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "36/1 10/1 0/1" } })
    .toBuffer();
}

describe("property photos", () => {
  beforeEach(async () => {
    await resetData();
    await makeCleaner();
  });

  it("shrinks uploads and strips EXIF/GPS metadata", async () => {
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const out = await normalizeImage(original);
    expect(Math.max(out.width, out.height)).toBe(2000);
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
  });

  it("rejects files that aren't images, even when named like one", async () => {
    await expect(normalizeImage(Buffer.from("<html><script>alert(1)</script></html>"))).rejects.toBeInstanceOf(ImageError);
    // Right magic bytes, broken body.
    await expect(normalizeImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]))).rejects.toBeInstanceOf(ImageError);
  });

  it("links photos to the request only with the matching key, and never twice", async () => {
    const mine = await storePropertyPhoto(await phonePhoto());
    const other = await storePropertyPhoto(await phonePhoto());
    const req = bookingRequest(weekdayAt(8, 10));
    req.photos = [mine, { id: other.id, key: "wrong-key-wrong-key-wrong-key" }];
    const r = await submitBookingRequest(req);
    expect(r.ok).toBe(true);
    const rows = await db()<{ id: string; quote_id: string | null; appointment_id: string | null }[]>`select id, quote_id, appointment_id from uploaded_images order by created_at`;
    const linked = rows.find((x) => x.id === mine.id)!;
    expect(linked.quote_id).not.toBeNull();
    expect(linked.appointment_id).not.toBeNull();
    expect(rows.find((x) => x.id === other.id)!.quote_id).toBeNull();

    // A second request reusing the same key can't move the photo.
    const again = bookingRequest(null, { email: "someone@example.test" });
    again.photos = [mine];
    await submitBookingRequest(again);
    const [after] = await db()<{ quote_id: string }[]>`select quote_id from uploaded_images where id = ${mine.id}`;
    expect(after.quote_id).toBe(linked.quote_id);
    // Attached photos can't be deleted with the upload key.
    expect(await deleteUnattachedPhoto(mine.id, mine.key)).toBe(false);
  });

  it("lets the uploader remove an unsubmitted photo, and purges abandoned ones", async () => {
    const a = await storePropertyPhoto(await phonePhoto());
    expect(await deleteUnattachedPhoto(a.id, "not-the-key-not-the-key")).toBe(false);
    expect(await deleteUnattachedPhoto(a.id, a.key)).toBe(true);
    const b = await storePropertyPhoto(await phonePhoto());
    await db()`update uploaded_images set created_at = now() - interval '2 days' where id = ${b.id}`;
    expect(await purgeAbandonedPhotos()).toBe(1);
  });
});

describe("intake details", () => {
  beforeEach(async () => {
    await resetData();
    await makeCleaner();
  });

  it("requires move-in or move-out for move cleanings and saves flooring and parking", async () => {
    const base = bookingRequest(null);
    base.property.service = "move";
    base.property.frequency = "one_time";
    const missing = await submitBookingRequest(base);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.field).toBe("property.move_type");

    const req = bookingRequest(null, { email: "mover@example.test" });
    Object.assign(req.property, { service: "move", frequency: "one_time", move_type: "move_out", flooring: ["tile", "carpet"] });
    req.contact.parking_instructions = "Visitor spaces by the pool (synthetic)";
    const ok = await submitBookingRequest(req);
    expect(ok.ok).toBe(true);
    const [q] = await db()<{ inputs: { move_type: string; flooring: string[] } }[]>`select inputs from quotes`;
    expect(q.inputs.move_type).toBe("move_out");
    expect(q.inputs.flooring).toEqual(["tile", "carpet"]);
    const [p] = await db()<{ flooring: string[]; parking_instructions: string }[]>`select flooring, parking_instructions from properties`;
    expect(p.flooring).toEqual(["tile", "carpet"]);
    expect(p.parking_instructions).toContain("Visitor spaces");
    // Parking is private and must not be copied into the quote the customer can open by link.
    expect(JSON.stringify(q.inputs)).not.toContain("Visitor spaces");
  });
});
