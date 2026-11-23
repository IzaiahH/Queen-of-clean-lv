import type { PhotoSummary } from "@/lib/server/images";

/** Customer-supplied property photos. Images load through the staff-only route, so links never work for the public. */
export function PropertyPhotos({ photos }: { photos: PhotoSummary[] }) {
  if (photos.length === 0) return <p className="text-sm text-muted">No photos were sent.</p>;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p, i) => (
        <li key={p.id}>
          <a href={`/api/admin/images/${p.id}`} target="_blank" rel="noopener" className="block aspect-square overflow-hidden rounded-[var(--radius-control)] border border-line bg-cream">
            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image route */}
            <img src={`/api/admin/images/${p.id}`} alt={`Property photo ${i + 1} from the customer`} loading="lazy" className="size-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
