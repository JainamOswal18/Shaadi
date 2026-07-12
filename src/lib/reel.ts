import { z } from "zod";

// Reel Maker data model (spec §3.G): pure, isomorphic helpers shared by the
// client editor (ReelMaker.tsx) and the server route (api/reel). No I/O here —
// db/http concerns live in db.ts / reel-client.ts.

export const ASPECTS = ["4:5", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const TRANSITIONS = ["crossfade", "kenburns", "cut"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const MIN_SECONDS = 3;
export const DEFAULT_SECONDS = 20;
export const MAX_SECONDS = 60;
export const MAX_PHOTOS = 30;

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** Public path served by the Next app; "" means no audio track. */
  src: string;
  /** Seconds; 0 for the silent option. */
  duration: number;
}

export const SONG_CATALOG: Song[] = [
  { id: "silent", title: "No music", artist: "—", src: "", duration: 0 },
  {
    id: "placeholder-1",
    title: "First Dance (placeholder)",
    artist: "Jeena",
    src: "/audio/placeholder-1.mp3",
    duration: 60,
  },
  {
    id: "placeholder-2",
    title: "Golden Hour (placeholder)",
    artist: "Jeena",
    src: "/audio/placeholder-2.mp3",
    duration: 60,
  },
];

export function songById(id: string): Song | undefined {
  return SONG_CATALOG.find((s) => s.id === id);
}

export const ReelSpecSchema = z
  .object({
    photoIds: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS),
    aspect: z.enum(ASPECTS).default("4:5"),
    totalSeconds: z.number().int().min(MIN_SECONDS).max(MAX_SECONDS).default(DEFAULT_SECONDS),
    transition: z.enum(TRANSITIONS).default("kenburns"),
    /** Optional per-photo weights; when present must match photoIds length. */
    perPhoto: z.array(z.number().positive()).optional(),
    song: z.object({ id: z.string().min(1), startSec: z.number().min(0).default(0) }),
  })
  .refine((s) => !s.perPhoto || s.perPhoto.length === s.photoIds.length, {
    message: "perPhoto length must match photoIds",
    path: ["perPhoto"],
  });
export type ReelSpec = z.infer<typeof ReelSpecSchema>;

export function aspectDimensions(aspect: Aspect): { width: number; height: number } {
  return aspect === "9:16" ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
}

/**
 * Seconds to show each photo. Even split by default; when `perPhoto` weights
 * are given they are normalized so the durations sum to exactly totalSeconds.
 * Zero/negative-sum weights (e.g. all zero) fall back to an even split rather
 * than dividing by zero.
 */
export function splitDurations(
  totalSeconds: number,
  count: number,
  perPhoto?: number[],
): number[] {
  if (count <= 0) return [];
  if (perPhoto && perPhoto.length === count) {
    const sum = perPhoto.reduce((a, b) => a + b, 0);
    if (sum <= 0) return new Array(count).fill(totalSeconds / count);
    return perPhoto.map((w) => (w / sum) * totalSeconds);
  }
  return new Array(count).fill(totalSeconds / count);
}
