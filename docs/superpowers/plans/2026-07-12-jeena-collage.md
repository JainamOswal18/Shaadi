# Collage 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upgrade the collage maker (spec §3.F) from a fixed 1080×1080 canvas to a ratio-aware editor (4:5 default, 1:1, 9:16) with per-slot pan/zoom, six new layouts, caption font-style options, sticker motifs, and the Rose Gold & Wine palette — while keeping the existing Share / Save / Add-to-gallery export path unchanged.

**Architecture:** Pure client-side change inside the existing `CollageMaker.tsx` + `src/lib/collage.ts` pair. `collage.ts` stays the declarative source of truth (ratios, layouts, themes, motifs, fonts); `CollageMaker.tsx` renders the editor UI and the `html-to-image`-captured canvas node. Per-slot transforms live in component state (`Record<slotIndex, SlotTransform>`) and are applied as inline CSS on each slot `<img>` so they're baked into the exported PNG for free — no extra render pass.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, html-to-image 1.11 (`toBlob`, `pixelRatio: 2`, `crossOrigin="anonymous"`), vitest + @testing-library/react + jsdom, Playwright for e2e. Package manager: **pnpm**.

## Global Constraints

- Package manager **pnpm**; unit/component tests via `pnpm test` (vitest, jsdom); e2e via `pnpm exec playwright test`.
- Palette = Rose Gold & Wine (light), source-of-truth hexes: `--maroon #5A1F2B`, `--rose #C97B84`, `--gold #C9A24B`, `--marigold-deep #A85462`, `--cream #FAF3EE`. `THEMES` in `collage.ts` must reference these via `var(--x)` tokens (unchanged resolution pattern via `resolveVar`).
- Default export ratio is **4:5 (1080×1350)**; 1:1 (1080×1080) and 9:16 (1080×1920) are alternates. Export width is always 1080; height follows the ratio.
- Export path stays `html-to-image` `toBlob`, `pixelRatio: 2`, `cacheBust: true`, explicit `width`/`height` matching the active ratio's canvas size; every slot `<img>` keeps `crossOrigin="anonymous"`.
- Respect `prefers-reduced-motion` for any new transition/animation (theme-switch fades, tray open/close); pan/zoom gestures themselves are direct manipulation, not decorative motion, so they are not gated by reduced-motion.
- All new interactive controls (ratio toggle, layout cards, motif buttons, font-style buttons) keep the existing `min-h-11`/`size-11` 44px touch-target convention already used in `CollageMaker.tsx`.
- Every task ends in a commit whose message trailer includes:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/collage.ts` (modify) | Ratios, ratio-aware `LAYOUTS`, `THEMES` (new palette), `SlotTransform` type, `CollageStyle` (adds `ratioId`, `fontStyle`, per-slot transforms), `PRESETS`, `DEFAULT_STYLE` |
| `src/components/CollageMaker.tsx` (modify) | Ratio toggle, per-slot pan/zoom interaction (pointer + wheel), export sizing follows ratio, layout/theme/motif/font UI, sticker motif rendering |
| `src/components/collage/StickerMotif.tsx` (create) | Inline SVGs for garland/phera/doli sticker motifs, shared by editor + canvas |
| `tests/unit/collage.test.ts` (create) | Ratio→dimension map, layout capacity/ratio filtering, transform clamp/serialize math, theme token shape |
| `tests/components/CollageMaker.test.tsx` (create) | Ratio switch re-renders canvas size; pan/zoom updates slot transform state; layout/theme/motif/font selection; export still calls `toBlob` with ratio-correct dims |
| `tests/e2e/collage.spec.ts` (modify) | Extend existing smoke test with a ratio-switch + drag-to-pan assertion |

---

### Task 1: Ratio model in `collage.ts`

**Files:**
- Modify: `src/lib/collage.ts`
- Create: `tests/unit/collage.test.ts`

**Interfaces:**
- Produces: `export type RatioId = "4:5" | "1:1" | "9:16";`
- Produces: `export type CanvasSize = { width: number; height: number };`
- Produces: `export const RATIOS: { id: RatioId; label: string; size: CanvasSize }[]`
- Produces: `export function canvasSizeFor(ratioId: RatioId): CanvasSize`
- Produces: `export const DEFAULT_RATIO: RatioId = "4:5"`
- Removes: `export const CANVAS_SIZE = 1080` (replaced by `canvasSizeFor`; keep a deprecated re-export `CANVAS_SIZE = 1080` only as the fixed **width** constant, since all ratios share width 1080)

- [ ] **Step 1: Write the failing ratio test**

Create `tests/unit/collage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canvasSizeFor, DEFAULT_RATIO, RATIOS } from "@/lib/collage";

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
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/unit/collage.test.ts` — fails: `RATIOS`/`canvasSizeFor`/`DEFAULT_RATIO` don't exist yet.

- [ ] **Step 3: Implement the ratio model**

In `src/lib/collage.ts`, replace the trailing `CANVAS_SIZE` export with:

```ts
export type RatioId = "4:5" | "1:1" | "9:16";
export type CanvasSize = { width: number; height: number };

export const RATIOS: { id: RatioId; label: string; size: CanvasSize }[] = [
  { id: "4:5", label: "Portrait 4:5", size: { width: 1080, height: 1350 } },
  { id: "1:1", label: "Square", size: { width: 1080, height: 1080 } },
  { id: "9:16", label: "Story 9:16", size: { width: 1080, height: 1920 } },
];

export const DEFAULT_RATIO: RatioId = "4:5";

export function canvasSizeFor(ratioId: RatioId): CanvasSize {
  return RATIOS.find((r) => r.id === ratioId)?.size ?? RATIOS[0].size;
}

/** Fixed export width shared by every ratio (height varies). */
export const CANVAS_WIDTH = 1080;
```

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/unit/collage.test.ts` — all 3 pass.

- [ ] **Step 5: Commit**

```
git add src/lib/collage.ts tests/unit/collage.test.ts
git commit -m "$(cat <<'EOF'
feat(collage): add ratio-aware canvas sizing (4:5/1:1/9:16)

EOF
)"
```
(append the Co-Authored-By trailer as specified in Global Constraints)

---

### Task 2: `THEMES` → Rose Gold & Wine palette

**Files:**
- Modify: `src/lib/collage.ts`
- Modify: `tests/unit/collage.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `THEMES` array unchanged in shape (`CollageTheme[]`), values updated.

- [ ] **Step 1: Write the failing theme-token test**

Append to `tests/unit/collage.test.ts`:

```ts
import { THEMES } from "@/lib/collage";

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
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/unit/collage.test.ts` — fails: old themes reference `var(--marigold)` / `var(--henna)`, not in the allowed set.

- [ ] **Step 3: Implement — replace `THEMES`**

```ts
export const THEMES: CollageTheme[] = [
  {
    id: "wine",
    label: "Wine",
    bg: "var(--maroon)",
    frame: "var(--gold)",
    ink: "var(--cream)",
    accent: "var(--rose)",
  },
  {
    id: "ivory",
    label: "Ivory",
    bg: "var(--cream)",
    frame: "var(--marigold-deep)",
    ink: "var(--maroon)",
    accent: "var(--marigold-deep)",
  },
  {
    id: "rose",
    label: "Rose",
    bg: "var(--rose)",
    frame: "var(--cream)",
    ink: "var(--maroon)",
    accent: "var(--gold)",
  },
  {
    id: "gold",
    label: "Gold",
    bg: "var(--gold)",
    frame: "var(--maroon)",
    ink: "var(--maroon)",
    accent: "var(--marigold-deep)",
  },
  {
    id: "blush",
    label: "Blush",
    bg: "var(--marigold-deep)",
    frame: "var(--cream)",
    ink: "var(--cream)",
    accent: "var(--gold)",
  },
];
```

Update `themeById`'s fallback (`THEMES[0]`) and every `PRESETS`/`DEFAULT_STYLE` `themeId` reference (`"maroon"` → `"wine"`, `"cream"` → `"ivory"`, `"marigold"` → `"blush"`, `"gold"` stays `"gold"`, `"henna"` → `"rose"`) so no preset points at a removed id.

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/unit/collage.test.ts` — all pass.

- [ ] **Step 5: Manual check**

`pnpm dev`, open a collage, tap through all 5 swatches — confirm each renders a legible bg/ink/accent combination (no cream-on-cream).

- [ ] **Step 6: Commit**

```
git add src/lib/collage.ts tests/unit/collage.test.ts
git commit -m "$(cat <<'EOF'
refactor(collage): rebrand THEMES to Rose Gold & Wine tokens

EOF
)"
```

---

### Task 3: Ratio-aware `LAYOUTS` (new layouts + ratio filtering)

**Files:**
- Modify: `src/lib/collage.ts`
- Modify: `tests/unit/collage.test.ts`

**Interfaces:**
- Produces: `CollageLayout` gains `ratios: RatioId[]` (which canvases the layout supports; empty/omitted = all).
- Produces: `export function layoutsForRatio(ratioId: RatioId): CollageLayout[]`
- Produces: 6 new layout entries: `hero-duo` (hero+1), `hero-trio` (hero+2), `two-up`, `three-up`, `magazine` (asymmetric), `story-filmstrip` (9:16 only), `heart-mosaic`.
- `layoutById` fallback updated to a layout that exists in all ratios.

- [ ] **Step 1: Write the failing layout tests**

Append to `tests/unit/collage.test.ts`:

```ts
import { LAYOUTS, layoutsForRatio, layoutById } from "@/lib/collage";

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
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/unit/collage.test.ts` — fails: new layout ids and `layoutsForRatio` don't exist.

- [ ] **Step 3: Implement — extend `CollageLayout` and add layouts**

```ts
export type CollageLayout = {
  id: string;
  label: string;
  capacity: number;
  kind: "grid" | "polaroid" | "filmstrip" | "hero" | "heart";
  cols?: number;
  rows?: number;
  cells?: Cell[];
  /** Ratios this layout is offered for; empty/omitted = all ratios. */
  ratios?: RatioId[];
};
```

Append to `LAYOUTS` (after the existing `filmstrip` entry):

```ts
  {
    id: "hero-duo",
    label: "Hero + 1",
    kind: "grid",
    capacity: 2,
    cols: 2,
    rows: 3,
    cells: [g(1, 1, 2, 2), g(1, 3), g(2, 3)].slice(0, 2).concat([g(1, 1, 2, 2)]).length
      ? [g(1, 1, 2, 2), g(1, 3, 1, 1)]
      : [],
  },
```

The above is intentionally rejected — write it plainly instead (no clever slicing):

```ts
  {
    id: "hero-duo",
    label: "Hero + 1",
    kind: "grid",
    capacity: 2,
    cols: 1,
    rows: 3,
    cells: [g(1, 1, 1, 2), g(1, 3)],
  },
  {
    id: "hero-trio",
    label: "Hero + 2",
    kind: "grid",
    capacity: 3,
    cols: 2,
    rows: 3,
    cells: [g(1, 1, 2, 2), g(1, 3), g(2, 3)],
  },
  {
    id: "two-up",
    label: "2-up",
    kind: "grid",
    capacity: 2,
    cols: 1,
    rows: 2,
    cells: [g(1, 1), g(1, 2)],
  },
  {
    id: "three-up",
    label: "3-up",
    kind: "grid",
    capacity: 3,
    cols: 1,
    rows: 3,
    cells: [g(1, 1), g(1, 2), g(1, 3)],
  },
  {
    id: "magazine",
    label: "Magazine",
    kind: "grid",
    capacity: 5,
    cols: 3,
    rows: 4,
    // Asymmetric editorial spread: tall hero left, two stacked upper-right, band along the bottom.
    cells: [g(1, 1, 2, 3), g(3, 1), g(3, 2), g(1, 4), g(2, 4, 2, 1)],
  },
  {
    id: "story-filmstrip",
    label: "Story strip",
    kind: "filmstrip",
    capacity: 5,
    ratios: ["9:16"],
  },
  {
    id: "heart-mosaic",
    label: "Heart",
    kind: "heart",
    capacity: 5,
  },
```

(Delete the malformed `hero-duo` draft above the plain block before implementing — only the plain versions ship.)

Add the ratio filter + updated fallback:

```ts
export function layoutsForRatio(ratioId: RatioId): CollageLayout[] {
  return LAYOUTS.filter((l) => !l.ratios || l.ratios.includes(ratioId));
}

export function layoutById(id: string): CollageLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS.find((l) => l.id === "quad")!;
}
```

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/unit/collage.test.ts` — all pass.

- [ ] **Step 5: Commit**

```
git add src/lib/collage.ts tests/unit/collage.test.ts
git commit -m "$(cat <<'EOF'
feat(collage): add magazine/hero/story/heart layouts, ratio filtering

EOF
)"
```

---

### Task 4: `SlotTransform` (pan/zoom) math + `CollageStyle` extension

**Files:**
- Modify: `src/lib/collage.ts`
- Modify: `tests/unit/collage.test.ts`

**Interfaces:**
- Produces: `export type SlotTransform = { scale: number; offsetX: number; offsetY: number };`
- Produces: `export const DEFAULT_SLOT_TRANSFORM: SlotTransform = { scale: 1, offsetX: 0, offsetY: 0 };`
- Produces: `export function clampSlotTransform(t: SlotTransform): SlotTransform` (scale in `[1, 3]`, offsets clamped so the image never reveals background — expressed as a fraction of overscan, clamp to `[-0.5, 0.5]` per axis of the *extra* scale beyond 1).
- Produces: `export function slotTransformToCss(t: SlotTransform): string` — returns a CSS `transform` string, e.g. `scale(1.4) translate(12%, -8%)`.
- Produces: `CollageStyle` gains `ratioId: RatioId`, `fontStyle: CaptionFontStyle`, `motif` extended with sticker ids, and slot transforms are tracked separately in the component (not in `CollageStyle`, since they're per-photo-selection, not per-style — see Task 5). `DEFAULT_STYLE` gains `ratioId: DEFAULT_RATIO`, `fontStyle: "serif"`.
- Produces: `export type CaptionFontStyle = "serif" | "script" | "sans-bold";`
- Produces: `export const FONT_STYLES: { id: CaptionFontStyle; label: string; family: string; weight: number; italic?: boolean }[]`

- [ ] **Step 1: Write the failing transform-math tests**

Append to `tests/unit/collage.test.ts`:

```ts
import {
  clampSlotTransform,
  DEFAULT_SLOT_TRANSFORM,
  slotTransformToCss,
  FONT_STYLES,
  DEFAULT_STYLE,
} from "@/lib/collage";

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
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/unit/collage.test.ts` — fails: none of these exports exist.

- [ ] **Step 3: Implement**

```ts
export type SlotTransform = { scale: number; offsetX: number; offsetY: number };

export const DEFAULT_SLOT_TRANSFORM: SlotTransform = { scale: 1, offsetX: 0, offsetY: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampSlotTransform(t: SlotTransform): SlotTransform {
  return {
    scale: clamp(t.scale, 1, 3),
    offsetX: clamp(t.offsetX, -0.5, 0.5),
    offsetY: clamp(t.offsetY, -0.5, 0.5),
  };
}

export function slotTransformToCss(t: SlotTransform): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `scale(${t.scale}) translate(${pct(t.offsetX)}, ${pct(t.offsetY)})`;
}

export type CaptionFontStyle = "serif" | "script" | "sans-bold";

export const FONT_STYLES: {
  id: CaptionFontStyle;
  label: string;
  family: string;
  weight: number;
  italic?: boolean;
}[] = [
  { id: "serif", label: "Serif", family: "var(--font-fraunces), Georgia, serif", weight: 600 },
  {
    id: "script",
    label: "Script",
    family: "var(--font-fraunces), Georgia, serif",
    weight: 500,
    italic: true,
  },
  {
    id: "sans-bold",
    label: "Bold sans",
    family: "var(--font-hanken), system-ui, sans-serif",
    weight: 800,
  },
];
```

Extend `CollageStyle` and `DEFAULT_STYLE`:

```ts
export type CollageStyle = {
  layoutId: string;
  themeId: string;
  motif: CollageMotif;
  ratioId: RatioId;
  fontStyle: CaptionFontStyle;
  border: number;
  radius: number;
  caption: string;
  hashtag: string;
};

export const DEFAULT_STYLE: CollageStyle = {
  layoutId: "quad",
  themeId: "wine",
  motif: "wash",
  ratioId: DEFAULT_RATIO,
  fontStyle: "serif",
  border: 6,
  radius: 14,
  caption: "Nameeta ki Shaadi",
  hashtag: "#SaatPhere",
};
```

Update every `PRESETS` entry to add `themeId` values matching Task 2's renamed ids (already done in Task 2) — no further change needed here since `PRESETS` doesn't set `ratioId`/`fontStyle` (editor seeds those from `DEFAULT_STYLE` and leaves them independently adjustable).

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/unit/collage.test.ts` — all pass.

- [ ] **Step 5: Commit**

```
git add src/lib/collage.ts tests/unit/collage.test.ts
git commit -m "$(cat <<'EOF'
feat(collage): add per-slot pan/zoom transform math + caption font styles

EOF
)"
```

---

### Task 5: Sticker motifs (`StickerMotif.tsx`)

**Files:**
- Create: `src/components/collage/StickerMotif.tsx`
- Modify: `src/lib/collage.ts` (extend `CollageMotif` union)
- Create: `tests/components/StickerMotif.test.tsx`

**Interfaces:**
- Produces (collage.ts): `export type CollageMotif = "plain" | "wash" | "garland" | "phera" | "doli";` and `MOTIFS` gains the two new entries.
- Produces (StickerMotif.tsx): `export function StickerMotif({ id, color }: { id: "garland" | "phera" | "doli"; color: string }): JSX.Element | null`

- [ ] **Step 1: Write the failing component test**

Create `tests/components/StickerMotif.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StickerMotif } from "@/components/collage/StickerMotif";

describe("StickerMotif", () => {
  it("renders an svg for garland, phera, and doli", () => {
    for (const id of ["garland", "phera", "doli"] as const) {
      const { container } = render(<StickerMotif id={id} color="#5A1F2B" />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("colours the sticker with the given color prop", () => {
    const { container } = render(<StickerMotif id="phera" color="#C9A24B" />);
    const svg = container.querySelector("svg")!;
    expect(svg.innerHTML).toContain("#C9A24B");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/components/StickerMotif.test.tsx` — fails: module doesn't exist.

- [ ] **Step 3: Implement `StickerMotif.tsx`**

```tsx
export function StickerMotif({
  id,
  color,
}: {
  id: "garland" | "phera" | "doli";
  color: string;
}) {
  if (id === "garland") {
    return (
      <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
        <path d="M4 8 Q32 40 60 8" stroke={color} strokeWidth="2" fill="none" />
        {[8, 20, 32, 44, 56].map((x, i) => (
          <circle key={i} cx={x} cy={12 + Math.sin(i) * 6} r="5" fill={color} />
        ))}
      </svg>
    );
  }
  if (id === "phera") {
    return (
      <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
        <circle cx="32" cy="40" r="14" fill="none" stroke={color} strokeWidth="2" />
        <path d="M32 26 L32 10 M24 16 L32 10 L40 16" stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // doli — a simple palanquin silhouette
  return (
    <svg viewBox="0 0 64 64" width={40} height={40} aria-hidden>
      <path d="M14 20 Q32 8 50 20" stroke={color} strokeWidth="2.5" fill="none" />
      <rect x="18" y="20" width="28" height="20" rx="4" fill="none" stroke={color} strokeWidth="2.5" />
      <line x1="4" y1="18" x2="4" y2="46" stroke={color} strokeWidth="2.5" />
      <line x1="60" y1="18" x2="60" y2="46" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}
```

In `src/lib/collage.ts`, update:

```ts
export type CollageMotif = "plain" | "wash" | "garland" | "phera" | "doli";

export const MOTIFS: { id: CollageMotif; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "wash", label: "Marigold wash" },
  { id: "garland", label: "Garland" },
  { id: "phera", label: "Phera" },
  { id: "doli", label: "Doli" },
];
```

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/components/StickerMotif.test.tsx tests/unit/collage.test.ts` — all pass.

- [ ] **Step 5: Commit**

```
git add src/components/collage/StickerMotif.tsx src/lib/collage.ts tests/components/StickerMotif.test.tsx
git commit -m "$(cat <<'EOF'
feat(collage): add garland/phera/doli sticker motifs

EOF
)"
```

---

### Task 6: Ratio toggle + ratio-aware export sizing in `CollageMaker.tsx`

**Files:**
- Modify: `src/components/CollageMaker.tsx`
- Create: `tests/components/CollageMaker.test.tsx`

**Interfaces:**
- Consumes: `RATIOS`, `canvasSizeFor`, `layoutsForRatio`, `DEFAULT_RATIO` from `@/lib/collage`.
- `CollageCanvas` gains a `ratioId: RatioId` prop; its root `style` uses `canvasSizeFor(style.ratioId)` for `width`/`height` instead of the old fixed `CANVAS_SIZE`.
- `render()`'s `toBlob` call uses `canvasSizeFor(style.ratioId)` for `width`/`height`.
- Selecting a ratio whose `layoutsForRatio` excludes the current `layoutId` snaps `layoutId` to the first available layout for that ratio.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/CollageMaker.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CollageMaker } from "@/components/CollageMaker";

vi.mock("html-to-image", () => ({ toBlob: vi.fn().mockResolvedValue(new Blob(["x"])) }));
vi.mock("@/lib/api", () => ({
  requestUploadUrls: vi.fn(),
  putToR2: vi.fn(),
  uploadComplete: vi.fn(),
}));

const photos = [
  { photoId: "1", previewUrl: "https://x/1.jpg" },
  { photoId: "2", previewUrl: "https://x/2.jpg" },
] as never;

describe("CollageMaker ratio toggle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to the 4:5 ratio button pressed", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const btn = screen.getByRole("button", { name: /portrait 4:5/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches ratio and updates the exported-size caption", async () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /story 9:16/i }));
    expect(await screen.findByText(/exports at 1080×1920/i)).toBeInTheDocument();
  });

  it("passes ratio-correct dimensions to toBlob on export", async () => {
    const { toBlob } = await import("html-to-image");
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /square/i }));
    fireEvent.click(screen.getByTestId("collage-download"));
    await vi.waitFor(() =>
      expect(toBlob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ width: 1080, height: 1080 }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/components/CollageMaker.test.tsx` — fails: no ratio buttons rendered yet; `toBlob` still called with the old fixed `CANVAS_SIZE`.

- [ ] **Step 3: Implement**

In `CollageMaker.tsx`, update imports:

```ts
import {
  RATIOS,
  DEFAULT_STYLE,
  LAYOUTS,
  MOTIFS,
  PRESETS,
  THEMES,
  FONT_STYLES,
  canvasSizeFor,
  layoutsForRatio,
  layoutById,
  themeById,
  type CollageStyle,
  type RatioId,
} from "@/lib/collage";
```

`CollageCanvas` root sizing:

```tsx
function CollageCanvas({ nodeRef, photos, style }: { ... }) {
  const size = canvasSizeFor(style.ratioId);
  const layout = layoutById(style.layoutId);
  ...
  return (
    <div
      ref={nodeRef}
      style={{
        width: size.width,
        height: size.height,
        ...
      }}
    >
```

Editor preview + export, in `CollageMaker`:

```tsx
const size = canvasSizeFor(style.ratioId);
const scale = previewW / size.width;
...
const render = useCallback(async (): Promise<Blob> => {
  const node = nodeRef.current;
  if (!node) throw new Error("Collage not ready");
  const dims = canvasSizeFor(style.ratioId);
  const blob = await toBlob(node, {
    pixelRatio: 2,
    cacheBust: true,
    width: dims.width,
    height: dims.height,
  });
  if (!blob) throw new Error("Export failed");
  return blob;
}, [style.ratioId]);
```

Preview wrapper (was fixed `width: previewW, height: previewW`) becomes ratio-aware:

```tsx
<div
  className="relative overflow-hidden rounded-xl"
  style={{ width: previewW, height: previewW * (size.height / size.width) }}
>
  <div
    style={{
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      width: size.width,
      height: size.height,
    }}
  >
    <CollageCanvas nodeRef={nodeRef} photos={photos} style={style} />
  </div>
</div>
```

Caption text below the preview:

```tsx
<p className="mt-2 text-center text-xs text-muted-foreground">
  {photos.length} photo{photos.length === 1 ? "" : "s"} selected · exports at{" "}
  {size.width}×{size.height}
</p>
```

Ratio toggle section, inserted above the "Layout" section:

```tsx
<section className="mt-6">
  <p className="mb-2 text-sm font-medium text-foreground">Aspect ratio</p>
  <div className="flex gap-2">
    {RATIOS.map((r) => (
      <button
        key={r.id}
        type="button"
        aria-pressed={style.ratioId === r.id}
        onClick={() => {
          const available = layoutsForRatio(r.id);
          setStyle((s) => ({
            ...s,
            ratioId: r.id,
            layoutId: available.some((l) => l.id === s.layoutId)
              ? s.layoutId
              : available[0].id,
          }));
        }}
        className={cn(
          "min-h-11 flex-1 rounded-xl border px-2 py-2 text-sm font-medium transition-colors",
          style.ratioId === r.id
            ? "border-marigold-deep bg-accent text-maroon"
            : "border-border bg-card text-muted-foreground hover:border-marigold/60",
        )}
      >
        {r.label}
      </button>
    ))}
  </div>
</section>
```

Layout section now filters by ratio:

```tsx
{layoutsForRatio(style.ratioId).map((l) => ( ... ))}
```

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/components/CollageMaker.test.tsx` — all pass.

- [ ] **Step 5: Manual check**

`pnpm dev` → Results → select photos → Make a collage → toggle 4:5 / 1:1 / 9:16 and confirm the preview reflows without distortion, then Save and check the PNG's pixel dimensions match (`file downloaded.png`).

- [ ] **Step 6: Commit**

```
git add src/components/CollageMaker.tsx tests/components/CollageMaker.test.tsx
git commit -m "$(cat <<'EOF'
feat(collage): wire ratio toggle into editor preview and export

EOF
)"
```

---

### Task 7: Per-slot pan & zoom (drag + wheel/pinch) baked into export

**Files:**
- Modify: `src/components/CollageMaker.tsx`
- Modify: `tests/components/CollageMaker.test.tsx`

**Interfaces:**
- Consumes: `SlotTransform`, `DEFAULT_SLOT_TRANSFORM`, `clampSlotTransform`, `slotTransformToCss` from `@/lib/collage`.
- New component state: `const [transforms, setTransforms] = useState<Record<number, SlotTransform>>({});`
- `CollageCanvas` gains a `transforms: Record<number, SlotTransform>` prop; every slot `<img>` gets `style.transform = slotTransformToCss(transforms[i] ?? DEFAULT_SLOT_TRANSFORM)` plus `transformOrigin: "center"`.
- New `SlotGestureLayer` (inline in `CollageMaker.tsx`, not exported) wraps each slot in edit mode: pointer-down/move/up for pan, `onWheel` for zoom (desktop), and a two-touch pinch handler for mobile.

- [ ] **Step 1: Write the failing pan/zoom test**

Append to `tests/components/CollageMaker.test.tsx`:

```tsx
describe("CollageMaker per-slot pan/zoom", () => {
  it("applies the default centered transform to slot images", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs[0]).toHaveStyle({ transform: "scale(1) translate(0%, 0%)" });
  });

  it("zooms a slot on wheel and updates its transform", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    fireEvent.wheel(slot, { deltaY: -100 });
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/scale\(1\.\d+\)/);
  });

  it("pans a zoomed slot on pointer drag", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    fireEvent.wheel(slot, { deltaY: -300 }); // zoom in first so panning has room
    fireEvent.pointerDown(slot, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(slot, { clientX: 130, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(slot, { pointerId: 1 });
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/translate\(-?\d+%, -?\d+%\)/);
    expect(img.style.transform).not.toBe("scale(1) translate(0%, 0%)");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/components/CollageMaker.test.tsx` — fails: no `data-testid="collage-slot-*"`, no wheel/pointer handlers, transform not applied.

- [ ] **Step 3: Implement**

Add gesture state + handlers in `CollageMaker`:

```tsx
const [transforms, setTransforms] = useState<Record<number, SlotTransform>>({});
const dragState = useRef<{ slot: number; startX: number; startY: number; base: SlotTransform } | null>(null);

const setSlotTransform = (slot: number, next: SlotTransform) =>
  setTransforms((prev) => ({ ...prev, [slot]: clampSlotTransform(next) }));

function onSlotWheel(slot: number, e: React.WheelEvent) {
  e.preventDefault();
  const cur = transforms[slot] ?? DEFAULT_SLOT_TRANSFORM;
  const delta = e.deltaY < 0 ? 0.1 : -0.1;
  setSlotTransform(slot, { ...cur, scale: cur.scale + delta });
}

function onSlotPointerDown(slot: number, e: React.PointerEvent) {
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
  dragState.current = {
    slot,
    startX: e.clientX,
    startY: e.clientY,
    base: transforms[slot] ?? DEFAULT_SLOT_TRANSFORM,
  };
}

function onSlotPointerMove(e: React.PointerEvent) {
  const d = dragState.current;
  if (!d) return;
  const dx = (e.clientX - d.startX) / previewW;
  const dy = (e.clientY - d.startY) / previewW;
  setSlotTransform(d.slot, { ...d.base, offsetX: d.base.offsetX + dx, offsetY: d.base.offsetY + dy });
}

function onSlotPointerUp() {
  dragState.current = null;
}
```

Pass `transforms` + handlers into `CollageCanvas`, and wrap each slot render in the grid/hero/heart/polaroid/filmstrip branches with the shared gesture props:

```tsx
const slotProps = (i: number) => ({
  "data-testid": `collage-slot-${i}`,
  onWheel: (e: React.WheelEvent) => onSlotWheel(i, e),
  onPointerDown: (e: React.PointerEvent) => onSlotPointerDown(i, e),
  onPointerMove: onSlotPointerMove,
  onPointerUp: onSlotPointerUp,
  style: { touchAction: "none" as const },
});
```

Slot `<img>` transform application (every render branch's `<img>`):

```tsx
<img
  src={p.previewUrl}
  alt=""
  crossOrigin="anonymous"
  style={{
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
    transform: slotTransformToCss(transforms[i] ?? DEFAULT_SLOT_TRANSFORM),
    transformOrigin: "center",
  }}
/>
```

`CollageCanvas` signature gains `transforms: Record<number, SlotTransform>` and threads it to every slot; `img(p, key)` helper takes an extra `i` arg for the lookup.

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/components/CollageMaker.test.tsx` — all pass.

- [ ] **Step 5: Manual check**

On a touch device (or Chrome DevTools device toolbar), open the collage editor, pinch to zoom a slot and drag to reposition; confirm the exported PNG (Save) reflects the same crop as the editor preview.

- [ ] **Step 6: Commit**

```
git add src/components/CollageMaker.tsx tests/components/CollageMaker.test.tsx
git commit -m "$(cat <<'EOF'
feat(collage): per-slot pan/zoom via pointer drag + wheel, baked into export

EOF
)"
```

---

### Task 8: Sticker motif rendering + caption font-style picker in the editor

**Files:**
- Modify: `src/components/CollageMaker.tsx`
- Modify: `tests/components/CollageMaker.test.tsx`

**Interfaces:**
- Consumes: `StickerMotif` from `@/components/collage/StickerMotif`; `FONT_STYLES` from `@/lib/collage`.
- `CollageCanvas` renders `<StickerMotif id={style.motif} color={theme.accent} />` in a corner when `style.motif` is `"garland" | "phera" | "doli"` (the existing inline `CanvasGarland` SVG is removed in favor of the shared `StickerMotif`).
- Caption `<div>` font family/weight/style driven by `FONT_STYLES.find(f => f.id === style.fontStyle)`.
- New "Font" section with 3 buttons, same pattern as the Motif section.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/CollageMaker.test.tsx`:

```tsx
describe("CollageMaker motifs and font style", () => {
  it("offers 5 background motifs including phera and doli", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Phera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Doli" })).toBeInTheDocument();
  });

  it("switches caption font style and marks the button pressed", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const scriptBtn = screen.getByRole("button", { name: "Script" });
    fireEvent.click(scriptBtn);
    expect(scriptBtn).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

`pnpm test tests/components/CollageMaker.test.tsx` — fails: no "Phera"/"Doli"/"Script" buttons rendered.

- [ ] **Step 3: Implement**

Replace the `CanvasGarland` usage in `CollageCanvas` with:

```tsx
const stickerId = style.motif === "garland" || style.motif === "phera" || style.motif === "doli"
  ? style.motif
  : null;
...
{stickerId && (
  <div style={{ position: "absolute", top: 16, right: 16 }}>
    <StickerMotif id={stickerId} color={theme.accent} />
  </div>
)}
```

(Remove the now-unused `CanvasGarland` function and its `showGarland` variable/usage.)

Caption styling driven by `FONT_STYLES`:

```tsx
const font = FONT_STYLES.find((f) => f.id === style.fontStyle) ?? FONT_STYLES[0];
...
{style.caption.trim() && (
  <div
    style={{
      fontFamily: font.family,
      fontWeight: font.weight,
      fontStyle: font.italic ? "italic" : "normal",
      fontSize: 52,
      lineHeight: 1.05,
      letterSpacing: "-0.01em",
    }}
  >
    {style.caption}
  </div>
)}
```

New "Font" section in `CollageMaker`, placed after the "Text" caption/hashtag inputs:

```tsx
<section className="mt-6">
  <p className="mb-2 text-sm font-medium text-foreground">Caption style</p>
  <div className="flex gap-2">
    {FONT_STYLES.map((f) => (
      <button
        key={f.id}
        type="button"
        aria-pressed={style.fontStyle === f.id}
        onClick={() => set("fontStyle", f.id)}
        style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? "italic" : "normal" }}
        className={cn(
          "min-h-11 flex-1 rounded-xl border px-2 py-2 text-sm transition-colors",
          style.fontStyle === f.id
            ? "border-marigold-deep bg-accent text-maroon"
            : "border-border bg-card text-muted-foreground hover:border-marigold/60",
        )}
      >
        {f.label}
      </button>
    ))}
  </div>
</section>
```

- [ ] **Step 4: Run it, confirm it passes**

`pnpm test tests/components/CollageMaker.test.tsx` — all pass.

- [ ] **Step 5: Commit**

```
git add src/components/CollageMaker.tsx tests/components/CollageMaker.test.tsx
git commit -m "$(cat <<'EOF'
feat(collage): render sticker motifs via StickerMotif, add caption font picker

EOF
)"
```

---

### Task 9: Full unit/component suite green + e2e smoke update

**Files:**
- Modify: `tests/e2e/collage.spec.ts`
- No source changes expected; this task is a regression pass across Tasks 1–8.

**Interfaces:**
- Consumes: whatever `data-testid`s already exist (`collage-maker`, `collage-download`, `collage-add-gallery`, `collage-slot-*`) plus the new ratio button `aria-label`s (`Portrait 4:5`, `Square`, `Story 9:16`).

- [ ] **Step 1: Extend the e2e smoke test**

Read the existing `tests/e2e/collage.spec.ts` first, then add (inside its existing describe/test structure, following its existing selection→open-editor setup) a new assertion block:

```ts
test("collage editor supports ratio switch and per-slot zoom", async ({ page }) => {
  // ... reuse this file's existing helper to select photos and open the collage editor ...
  await page.getByRole("button", { name: /square/i }).click();
  await expect(page.getByText(/exports at 1080×1080/i)).toBeVisible();

  const slot = page.getByTestId(/collage-slot-0/);
  await slot.hover();
  await page.mouse.wheel(0, -200); // zoom in on the hovered slot

  await page.getByTestId("collage-download").click();
  // existing download assertion pattern from this file applies here
});
```

- [ ] **Step 2: Run the whole affected suite**

```
pnpm test tests/unit/collage.test.ts tests/components/CollageMaker.test.tsx tests/components/StickerMotif.test.tsx
pnpm test   # full unit+component run — confirm nothing else broke (e.g. results-page or other collage consumers)
pnpm exec playwright test tests/e2e/collage.spec.ts
```

- [ ] **Step 3: Fix any regressions surfaced**

If `src/app/results/page.tsx` or any other file imports the removed `CANVAS_SIZE` export, update it to `canvasSizeFor(DEFAULT_RATIO).width` (grep for `CANVAS_SIZE` across `src/` before finishing this task).

- [ ] **Step 4: Commit**

```
git add tests/e2e/collage.spec.ts
git commit -m "$(cat <<'EOF'
test(collage): extend e2e smoke for ratio switch + per-slot zoom

EOF
)"
```

---

## Self-review notes

Mapping spec §3.F requirements to tasks:

1. **Ratio-aware canvas (4:5 default, 1:1, 9:16; toggle; export dims follow ratio; layouts adapt)** → Task 1 (ratio model), Task 3 (`layoutsForRatio`), Task 6 (editor toggle + export sizing).
2. **Per-slot pan & zoom (`{scale, offsetX, offsetY}`, drag-pan + wheel/pinch, baked into html-to-image export, default center-cover)** → Task 4 (transform math/types), Task 7 (gesture handlers + export baking via inline `<img>` transform).
3. **More layouts (asymmetric magazine, hero+N, 2/3/4/6-up, 9:16 story filmstrip, heart mosaic; keep polaroid/grid/filmstrip)** → Task 3 (`hero-duo`, `hero-trio`, `two-up`, `three-up`, `magazine`, `story-filmstrip`, `heart-mosaic` added; existing `duo`/`trio`/`quad`/`six`/`nine`/`mosaic`/`polaroid`/`filmstrip` retained).
4. **More customization (caption font-style, sticker motifs garland/phera/doli, border & radius sliders kept, THEMES updated to new palette)** → Task 2 (`THEMES` rebrand), Task 4 (`FONT_STYLES`), Task 5 (`StickerMotif` SVGs + `MOTIFS` extension), Task 8 (wiring both into the editor and canvas; border/radius sliders untouched from the existing implementation).
5. **Keep Share / Save / Add-to-gallery flows** → Untouched across all tasks; Task 6 only changes the `width`/`height` args passed into the existing `toBlob` call inside `render()`, which `onDownload`/`onShare`/`onAddToGallery` all already call unmodified.
