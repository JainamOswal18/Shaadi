import { describe, expect, it } from "vitest";
import { canvasSizeFor, DEFAULT_RATIO, RATIOS, THEMES } from "@/lib/collage";

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
