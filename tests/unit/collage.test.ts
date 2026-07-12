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

  it("clamps pan offsets to [-0.5, 0.5]", () => {
    expect(clampSlotTransform({ scale: 2, offsetX: 1.2, offsetY: -9 })).toEqual({
      scale: 2,
      offsetX: 0.5,
      offsetY: -0.5,
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
