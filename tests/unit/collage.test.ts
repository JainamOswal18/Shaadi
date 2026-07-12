import { describe, expect, it } from "vitest";
import {
  canvasSizeFor,
  DEFAULT_RATIO,
  RATIOS,
  THEMES,
  LAYOUTS,
  layoutsForRatio,
  layoutById,
  clampSlotTransform,
  DEFAULT_SLOT_TRANSFORM,
  slotTransformToCss,
  FONT_STYLES,
  DEFAULT_STYLE,
  HEART_CLIP_PATH,
  pinchScale,
  pointerDistance,
} from "@/lib/collage";

describe("collage ratios", () => {
  it("exposes exactly 4:5, 1:1, 9:16 with 1080-wide canvases", () => {
    expect(RATIOS.map((r) => r.id)).toEqual(["4:5", "1:1", "9:16"]);
    expect(canvasSizeFor("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(canvasSizeFor("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(canvasSizeFor("9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("defaults to 4:5", () => {
    expect(DEFAULT_RATIO).toBe("4:5");
  });

  it("falls back to 4:5 for an unknown ratio id", () => {
    // @ts-expect-error - intentionally invalid input to exercise the fallback
    expect(canvasSizeFor("16:9")).toEqual({ width: 1080, height: 1350 });
  });
});

describe("collage themes", () => {
  it("resolves every theme colour to a Rose Gold & Wine token", () => {
    const allowed = new Set([
      "var(--maroon)",
      "var(--rose)",
      "var(--gold)",
      "var(--marigold-deep)",
      "var(--cream)",
    ]);
    for (const t of THEMES) {
      for (const key of ["bg", "frame", "ink", "accent"] as const) {
        expect(allowed.has(t[key]), `${t.id}.${key} = ${t[key]}`).toBe(true);
      }
    }
  });

  it("keeps 5 themes with unique ids", () => {
    expect(THEMES).toHaveLength(5);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(5);
  });
});

describe("collage layouts", () => {
  it("includes the new magazine-style layouts alongside the existing ones", () => {
    const ids = LAYOUTS.map((l) => l.id);
    for (const id of [
      "duo", "trio", "quad", "six", "nine", "mosaic", "polaroid", "filmstrip",
      "hero-duo", "hero-trio", "two-up", "three-up", "magazine", "story-filmstrip", "heart-mosaic",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("restricts story-filmstrip to 9:16 only", () => {
    const l = LAYOUTS.find((x) => x.id === "story-filmstrip")!;
    expect(l.ratios).toEqual(["9:16"]);
    expect(layoutsForRatio("9:16").map((x) => x.id)).toContain("story-filmstrip");
    expect(layoutsForRatio("4:5").map((x) => x.id)).not.toContain("story-filmstrip");
    expect(layoutsForRatio("1:1").map((x) => x.id)).not.toContain("story-filmstrip");
  });

  it("makes layouts without an explicit ratios list available everywhere", () => {
    const quad = LAYOUTS.find((x) => x.id === "quad")!;
    expect(quad.ratios ?? []).toEqual([]);
    for (const r of ["4:5", "1:1", "9:16"] as const) {
      expect(layoutsForRatio(r).map((x) => x.id)).toContain("quad");
    }
  });

  it("heart-mosaic holds 5 photos and magazine holds 5", () => {
    expect(layoutById("heart-mosaic").capacity).toBe(5);
    expect(layoutById("magazine").capacity).toBe(5);
  });

  it("falls back to quad for an unknown layout id", () => {
    expect(layoutById("nonexistent").id).toBe("quad");
  });
});

describe("slot pan/zoom transform", () => {
  it("defaults to centered, unzoomed", () => {
    expect(DEFAULT_SLOT_TRANSFORM).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it("clamps scale to [1, 3]", () => {
    expect(clampSlotTransform({ scale: 0.2, offsetX: 0, offsetY: 0 }).scale).toBe(1);
    expect(clampSlotTransform({ scale: 5, offsetX: 0, offsetY: 0 }).scale).toBe(3);
    expect(clampSlotTransform({ scale: 2, offsetX: 0, offsetY: 0 }).scale).toBe(2);
  });

  it("clamps pan offsets to [-0.5, 0.5] at scale 2", () => {
    expect(clampSlotTransform({ scale: 2, offsetX: 1.2, offsetY: -9 })).toEqual({
      scale: 2,
      offsetX: 0.5,
      offsetY: -0.5,
    });
  });

  it("scales the pan clamp with zoom so the frame background can never show", () => {
    // At scale 1 the image exactly fills the frame: no pan headroom at all.
    expect(clampSlotTransform({ scale: 1, offsetX: 0.4, offsetY: -0.4 })).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // At scale 2 there's (2-1)/2 = 0.5 of headroom on each side.
    expect(clampSlotTransform({ scale: 2, offsetX: 5, offsetY: -5 })).toEqual({
      scale: 2,
      offsetX: 0.5,
      offsetY: -0.5,
    });
    // At scale 3 (the max) there's (3-1)/2 = 1.0 of headroom on each side.
    expect(clampSlotTransform({ scale: 3, offsetX: 5, offsetY: -5 })).toEqual({
      scale: 3,
      offsetX: 1,
      offsetY: -1,
    });
    // Values already inside the per-scale bound pass through unchanged.
    expect(clampSlotTransform({ scale: 2, offsetX: 0.3, offsetY: -0.2 })).toEqual({
      scale: 2,
      offsetX: 0.3,
      offsetY: -0.2,
    });
  });

  it("serializes to a CSS transform string", () => {
    expect(slotTransformToCss({ scale: 1, offsetX: 0, offsetY: 0 })).toBe(
      "scale(1) translate(0%, 0%)",
    );
    expect(slotTransformToCss({ scale: 1.4, offsetX: 0.12, offsetY: -0.08 })).toBe(
      "scale(1.4) translate(12%, -8%)",
    );
  });

  it("also clamps the pan when serializing to CSS, even if given an out-of-range offset", () => {
    // Defense in depth: even a SlotTransform that skipped clampSlotTransform
    // must never produce CSS that exposes the frame background.
    expect(slotTransformToCss({ scale: 1, offsetX: 0.5, offsetY: -0.5 })).toBe(
      "scale(1) translate(0%, 0%)",
    );
    expect(slotTransformToCss({ scale: 2, offsetX: 5, offsetY: -5 })).toBe(
      "scale(2) translate(50%, -50%)",
    );
  });
});

describe("pinch-to-zoom math", () => {
  it("measures the distance between two pointer points", () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pointerDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it("scales up as fingers spread apart and down as they pinch closer", () => {
    expect(pinchScale(100, 200, 1)).toBe(2); // doubled distance -> doubled scale
    expect(pinchScale(200, 100, 2)).toBe(1); // halved distance -> halved scale
    expect(pinchScale(100, 100, 1.5)).toBe(1.5); // no movement -> unchanged
  });

  it("clamps the resulting scale to [1, 3]", () => {
    expect(pinchScale(100, 1000, 1)).toBe(3);
    expect(pinchScale(1000, 1, 3)).toBe(1);
  });

  it("is a no-op for a degenerate (zero/negative) start distance", () => {
    expect(pinchScale(0, 100, 1.7)).toBe(1.7);
    expect(pinchScale(-5, 100, 2)).toBe(2);
  });
});

describe("heart-mosaic clip path", () => {
  it("is a closed CSS polygon() clip-path", () => {
    expect(HEART_CLIP_PATH.startsWith("polygon(")).toBe(true);
    expect(HEART_CLIP_PATH.endsWith(")")).toBe(true);
  });

  it("every vertex is a valid in-bounds percentage pair", () => {
    const inner = HEART_CLIP_PATH.slice("polygon(".length, -1);
    const points = inner.split(", ");
    expect(points.length).toBeGreaterThan(10);
    for (const point of points) {
      const [x, y] = point.split(" ").map((p) => parseFloat(p));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });

  it("heart-mosaic is still offered as a layout with capacity 5", () => {
    const heart = layoutById("heart-mosaic");
    expect(heart.kind).toBe("heart");
    expect(heart.capacity).toBe(5);
    expect(layoutsForRatio("4:5").map((l) => l.id)).toContain("heart-mosaic");
  });
});

describe("caption font styles", () => {
  it("offers 3 font styles including serif default", () => {
    expect(FONT_STYLES.map((f) => f.id)).toEqual(["serif", "script", "sans-bold"]);
  });

  it("DEFAULT_STYLE uses the serif font and 4:5 ratio", () => {
    expect(DEFAULT_STYLE.fontStyle).toBe("serif");
    expect(DEFAULT_STYLE.ratioId).toBe("4:5");
  });
});
