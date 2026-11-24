"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";

export type UploadedPhoto = { id: string; key: string; preview?: string };

const MAX_PHOTOS = 6;
const MAX_EDGE = 2000;

/** Shrinks a photo in the browser so uploads are quick on mobile data. Falls back to the original file. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size > 0 ? blob : file;
  } catch {
    return file;
  }
}

/** `onChange` receives an updater so uploads that finish one after another never overwrite each other. */
export function PhotoUploader({ photos, onChange }: { photos: UploadedPhoto[]; onChange: (update: (prev: UploadedPhoto[]) => UploadedPhoto[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const room = MAX_PHOTOS - photos.length - busy;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > list.length) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    for (const file of list) {
      setBusy((b) => b + 1);
      try {
        const blob = await shrink(file);
        const form = new FormData();
        form.append("file", blob, "photo.jpg");
        const res = await fetch("/api/uploads/property-photo", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "That photo didn't upload. Please try again.");
        } else {
          const added = { id: data.photo.id as string, key: data.photo.key as string, preview: URL.createObjectURL(blob) };
          onChange((prev) => [...prev, added]);
        }
      } catch {
        setError("We couldn't reach the server. Check your connection and try again.");
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  function remove(p: UploadedPhoto) {
    onChange((prev) => prev.filter((x) => x.id !== p.id));
    if (p.preview) URL.revokeObjectURL(p.preview);
    void fetch("/api/uploads/property-photo", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, key: p.key }) }).catch(() => {});
  }

  return (
    <fieldset>
      <legend className="field-label">
        Photos of your home <span className="font-normal text-muted">(optional)</span>
      </legend>
      <p className="field-hint mb-3">Up to {MAX_PHOTOS} photos of the areas that need the most attention help us confirm your price. Only our team can see them.</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {photos.map((p, i) => (
          <li key={p.id} className="relative aspect-square overflow-hidden rounded-[var(--radius-control)] border border-line bg-cream">
            {p.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the customer's own upload
              <img src={p.preview} alt={`Your photo ${i + 1}`} className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-xs text-muted">Photo {i + 1}</span>
            )}
            <button type="button" onClick={() => remove(p)} className="absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-full bg-charcoal/80 text-ivory" aria-label={`Remove photo ${i + 1}`}>
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
        {Array.from({ length: busy }).map((_, i) => (
          <li key={`busy-${i}`} className="flex aspect-square items-center justify-center rounded-[var(--radius-control)] border border-dashed border-gold/60">
            <Loader2 className="size-5 animate-spin text-gold-dark" aria-label="Uploading" />
          </li>
        ))}
      </ul>
      {photos.length + busy < MAX_PHOTOS && (
        <>
          <input ref={input} id="property-photos" type="file" accept="image/*" multiple className="sr-only" onChange={(e) => void add(e.target.files)} />
          <label htmlFor="property-photos" className="btn btn-outline mt-3 w-full cursor-pointer sm:w-auto">
            <Camera className="size-4" aria-hidden />
            {photos.length ? "Add more photos" : "Add photos"}
          </label>
        </>
      )}
      <p aria-live="polite" className="sr-only">{busy ? "Uploading photo" : ""}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </fieldset>
  );
}
