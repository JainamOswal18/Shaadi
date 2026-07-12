// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ASPECTS,
  DEFAULT_SECONDS,
  MAX_PHOTOS,
  MAX_SECONDS,
  MIN_SECONDS,
  ReelSpecSchema,
  SONG_CATALOG,
  TRANSITIONS,
  aspectDimensions,
  songById,
  splitDurations,
} from "@/lib/reel";

describe("splitDurations", () => {
  it("splits evenly across photos by default", () => {
    expect(splitDurations(20, 4)).toEqual([5, 5, 5, 5]);
  });

  it("normalizes weighted per-photo durations to sum exactly to totalSeconds", () => {
    expect(splitDurations(20, 2, [1, 3])).toEqual([5, 15]);
  });

  it("any output sums to totalSeconds within 1e-9, weighted or not", () => {
    const evenOut = splitDurations(20, 3);
    expect(Math.abs(evenOut.reduce((a, b) => a + b, 0) - 20)).toBeLessThan(1e-9);

    const weightedOut = splitDurations(37, 5, [2, 1, 4, 3, 5]);
    expect(Math.abs(weightedOut.reduce((a, b) => a + b, 0) - 37)).toBeLessThan(1e-9);
  });

  it("returns [] for count <= 0", () => {
    expect(splitDurations(20, 0)).toEqual([]);
    expect(splitDurations(20, -3)).toEqual([]);
  });

  it("falls back to an even split when weights are zero/negative-sum", () => {
    expect(splitDurations(20, 4, [0, 0, 0, 0])).toEqual([5, 5, 5, 5]);
    expect(splitDurations(20, 2, [-1, -1])).toEqual([10, 10]);
  });
});

describe("aspectDimensions", () => {
  it("returns 1080x1350 for 4:5", () => {
    expect(aspectDimensions("4:5")).toEqual({ width: 1080, height: 1350 });
  });

  it("returns 1080x1920 for 9:16", () => {
    expect(aspectDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("songById", () => {
  it("finds a song in the catalog", () => {
    expect(songById("silent")?.title).toBe("No music");
  });

  it("returns undefined for an unknown id", () => {
    expect(songById("does-not-exist")).toBeUndefined();
  });

  it("catalog includes the silent option and two placeholders", () => {
    expect(SONG_CATALOG.map((s) => s.id)).toEqual(["silent", "placeholder-1", "placeholder-2"]);
  });
});

describe("ReelSpecSchema", () => {
  const base = {
    photoIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-9222-222222222222",
    ],
    song: { id: "silent" },
  };

  it("applies defaults for aspect, totalSeconds, transition, and song.startSec", () => {
    const parsed = ReelSpecSchema.parse(base);
    expect(parsed.aspect).toBe("4:5");
    expect(parsed.totalSeconds).toBe(DEFAULT_SECONDS);
    expect(parsed.transition).toBe("kenburns");
    expect(parsed.song.startSec).toBe(0);
  });

  it("parses a fully specified valid spec", () => {
    const parsed = ReelSpecSchema.parse({
      ...base,
      aspect: "9:16",
      totalSeconds: 30,
      transition: "crossfade",
      song: { id: "placeholder-1", startSec: 5 },
    });
    expect(parsed.aspect).toBe("9:16");
    expect(parsed.totalSeconds).toBe(30);
    expect(parsed.transition).toBe("crossfade");
    expect(parsed.song).toEqual({ id: "placeholder-1", startSec: 5 });
  });

  it("rejects totalSeconds above MAX_SECONDS (61)", () => {
    expect(() => ReelSpecSchema.parse({ ...base, totalSeconds: 61 })).toThrow();
  });

  it("rejects totalSeconds below MIN_SECONDS (2)", () => {
    expect(() => ReelSpecSchema.parse({ ...base, totalSeconds: 2 })).toThrow();
  });

  it("rejects an empty photoIds array", () => {
    expect(() => ReelSpecSchema.parse({ ...base, photoIds: [] })).toThrow();
  });

  it("rejects more than MAX_PHOTOS photoIds", () => {
    const tooMany = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(() => ReelSpecSchema.parse({ ...base, photoIds: tooMany })).toThrow();
  });

  it("rejects a perPhoto array whose length doesn't match photoIds", () => {
    expect(() => ReelSpecSchema.parse({ ...base, perPhoto: [1, 2, 3] })).toThrow();
  });

  it("rejects an unknown song.id instead of silently producing a music-less reel", () => {
    expect(() =>
      ReelSpecSchema.parse({ ...base, song: { id: "not-a-real-song" } }),
    ).toThrow();
  });

  it("accepts every id in the song catalog", () => {
    for (const s of SONG_CATALOG) {
      expect(() => ReelSpecSchema.parse({ ...base, song: { id: s.id } })).not.toThrow();
    }
  });

  it("threads an optional guestName through, defaulting to undefined when omitted", () => {
    expect(ReelSpecSchema.parse(base).guestName).toBeUndefined();
    expect(ReelSpecSchema.parse({ ...base, guestName: "Priya" }).guestName).toBe("Priya");
    // Client always sends the field; a blank guest name must not 400.
    expect(() => ReelSpecSchema.parse({ ...base, guestName: "" })).not.toThrow();
  });

  it("exposes the aspect and transition option lists", () => {
    expect(ASPECTS).toEqual(["4:5", "9:16"]);
    expect(TRANSITIONS).toEqual(["crossfade", "kenburns", "cut"]);
    expect(MIN_SECONDS).toBe(3);
    expect(MAX_SECONDS).toBe(60);
  });
});
