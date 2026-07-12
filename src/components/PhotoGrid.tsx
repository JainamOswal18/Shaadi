"use client";

import { Check, Sparkles } from "lucide-react";
import type { SearchResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type Photo = SearchResponse["matches"][number];

/**
 * Responsive CSS-columns masonry of thumbnails. Uses <picture> + lazy loading
 * and content-visibility so long galleries stay light.
 *
 * In `selectable` mode a tap toggles the photo into a selection set (for the
 * collage maker) instead of opening the lightbox.
 */
export function PhotoGrid({
  photos,
  onSelect,
  selectable = false,
  selectedIds,
  onToggle,
}: {
  photos: Photo[];
  onSelect: (index: number) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (photoId: string) => void;
}) {
  return (
    <ul className="columns-2 gap-3 sm:columns-3 [&>li]:mb-3">
      {photos.map((photo, i) => {
        const selected = !!selectedIds?.has(photo.photoId);
        return (
          <li key={photo.photoId} className="break-inside-avoid">
            <button
              type="button"
              onClick={() => (selectable ? onToggle?.(photo.photoId) : onSelect(i))}
              data-testid={selectable ? "photo-select" : "photo-thumb"}
              aria-pressed={selectable ? selected : undefined}
              className={cn(
                "group relative block w-full overflow-hidden rounded-xl border bg-muted shadow-[var(--shadow-card)] transition-transform duration-200 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]",
                selected
                  ? "border-marigold-deep ring-2 ring-marigold-deep"
                  : "border-border",
              )}
              style={{ contentVisibility: "auto" }}
              aria-label={
                selectable
                  ? `${selected ? "Deselect" : "Select"} photo ${i + 1}`
                  : `Open photo ${i + 1}${photo.similarity ? `, ${Math.round(photo.similarity * 100)}% match` : ""}`
              }
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
                  className={cn(
                    "w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]",
                    selected && "scale-[0.97]",
                  )}
                />
              </picture>

              {selectable ? (
                <span
                  className={cn(
                    "absolute right-2 top-2 grid size-7 place-items-center rounded-full border-2 transition-colors",
                    selected
                      ? "border-marigold-deep bg-marigold-deep text-white"
                      : "border-white/80 bg-black/25 text-transparent",
                  )}
                >
                  <Check className="size-4" />
                </span>
              ) : (
                <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-maroon/80 px-2 py-0.5 text-[11px] font-medium text-cream opacity-0 transition-opacity group-hover:opacity-100">
                  <Sparkles className="size-3" />
                  {Math.round(photo.similarity * 100)}%
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
