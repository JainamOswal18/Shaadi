"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { toast } from "sonner";
import type { SearchResponse } from "@/lib/types";
import { downloadUrl, saveFromApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type Photo = SearchResponse["matches"][number];

export function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [slideDir, setSlideDir] = useState<"l" | "r" | null>(null);
  const photo = photos[index];

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      setSlideDir(delta > 0 ? "l" : "r");
      onIndexChange(next);
    },
    [index, onIndexChange, photos.length],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  if (!photo) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${photos.length}`}
      className="fixed inset-0 z-50 flex flex-col bg-maroon/95 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => (touchStartX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchStartX.current == null) return;
        const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
        if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
        touchStartX.current = null;
      }}
    >
      <div className="flex items-center justify-between gap-3 p-4 text-cream">
        <span className="tabular text-sm font-medium text-cream/90">
          {index + 1} / {photos.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="download-original"
            onClick={async () => {
              try {
                await saveFromApi(downloadUrl(photo.photoId), `${photo.photoId}.jpg`);
              } catch {
                toast.error("Couldn't download this photo");
              }
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-marigold-deep px-4 text-sm font-medium text-white transition-colors hover:bg-marigold focus-visible:ring-3 focus-visible:ring-cream/50 focus-visible:outline-none"
          >
            <Download className="size-5" /> <span className="hidden sm:inline">Download</span> original
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close photo"
            className="grid size-11 place-items-center rounded-xl bg-cream/10 text-cream transition-colors hover:bg-cream/20 focus-visible:ring-3 focus-visible:ring-cream/50 focus-visible:outline-none"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.photoId}
          src={photo.previewUrl}
          alt={`Wedding photo ${index + 1}`}
          data-testid="lightbox-image"
          className={cn(
            "max-h-full max-w-full rounded-lg object-contain shadow-[var(--shadow-float)]",
            slideDir === "l" && "animate-in slide-in-from-right-6 fade-in duration-200",
            slideDir === "r" && "animate-in slide-in-from-left-6 fade-in duration-200",
          )}
        />

        {index > 0 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 grid size-11 place-items-center rounded-full bg-cream/10 text-cream transition-colors hover:bg-cream/25 focus-visible:ring-3 focus-visible:ring-cream/50 focus-visible:outline-none"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 grid size-11 place-items-center rounded-full bg-cream/10 text-cream transition-colors hover:bg-cream/25 focus-visible:ring-3 focus-visible:ring-cream/50 focus-visible:outline-none"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>
    </div>
  );
}
