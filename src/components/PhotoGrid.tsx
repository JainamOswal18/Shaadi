"use client";

import { Sparkles } from "lucide-react";
import type { SearchResponse } from "@/lib/types";

type Photo = SearchResponse["matches"][number];

/**
 * Responsive CSS-columns masonry of thumbnails. Uses <picture> + lazy loading
 * and content-visibility so long galleries stay light.
 */
export function PhotoGrid({
  photos,
  onSelect,
}: {
  photos: Photo[];
  onSelect: (index: number) => void;
}) {
  return (
    <ul className="columns-2 gap-3 sm:columns-3 [&>li]:mb-3">
      {photos.map((photo, i) => (
        <li key={photo.photoId} className="break-inside-avoid">
          <button
            type="button"
            onClick={() => onSelect(i)}
            data-testid="photo-thumb"
            className="group relative block w-full overflow-hidden rounded-xl border border-border bg-muted shadow-[var(--shadow-card)] transition-transform duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]"
            style={{ contentVisibility: "auto" }}
            aria-label={`Open photo ${i + 1}${photo.similarity ? `, ${Math.round(photo.similarity * 100)}% match` : ""}`}
          >
            <picture>
              <source srcSet={photo.thumbUrl} type="image/webp" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.thumbUrl}
                alt={`Wedding photo ${i + 1}`}
                loading="lazy"
                decoding="async"
                sizes="(max-width: 640px) 50vw, 33vw"
                className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            </picture>
            <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-maroon/80 px-2 py-0.5 text-[11px] font-medium text-cream opacity-0 transition-opacity group-hover:opacity-100">
              <Sparkles className="size-3" />
              {Math.round(photo.similarity * 100)}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
