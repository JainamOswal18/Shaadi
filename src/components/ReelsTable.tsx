"use client";

import { Film } from "lucide-react";
import type { ReelItem } from "@/lib/api";

/** Admin-only "Reels" gallery: rendered guest reels, playable inline. */
export function ReelsTable({ reels }: { reels: ReelItem[] }) {
  if (reels.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
        <Film className="mx-auto mb-2 size-6 text-muted-foreground" />
        No reels have been made yet.
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {reels.map((r) => (
        <li
          key={r.id}
          data-testid="reel-item"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            data-testid="reel-item-video"
            src={r.url}
            controls
            playsInline
            className="aspect-[4/5] w-full bg-black object-contain"
          />
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <span className="truncate text-sm font-medium text-foreground">
              {r.guest ?? "Guest"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
