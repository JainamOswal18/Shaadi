/**
 * Collage maker configuration: layout variants, colour themes, background
 * motifs, and the shareable hashtag presets. Kept declarative so the editor UI
 * and the rendered canvas stay in sync from one source of truth.
 */

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

export type Cell = { col: number; row: number; colSpan: number; rowSpan: number };

export type CollageLayout = {
  id: string;
  label: string;
  /** How many photos this layout holds. */
  capacity: number;
  /** "grid" layouts use `cols`/`rows`/`cells`; others render bespoke frames. */
  kind: "grid" | "polaroid" | "filmstrip" | "hero" | "heart";
  cols?: number;
  rows?: number;
  cells?: Cell[];
  /** Ratios this layout is offered for; empty/omitted = all ratios. */
  ratios?: RatioId[];
};

const g = (col: number, row: number, colSpan = 1, rowSpan = 1): Cell => ({
  col,
  row,
  colSpan,
  rowSpan,
});

export const LAYOUTS: CollageLayout[] = [
  {
    id: "duo",
    label: "Duo",
    kind: "grid",
    capacity: 2,
    cols: 2,
    rows: 1,
    cells: [g(1, 1), g(2, 1)],
  },
  {
    id: "trio",
    label: "Trio",
    kind: "grid",
    capacity: 3,
    cols: 2,
    rows: 2,
    cells: [g(1, 1, 1, 2), g(2, 1), g(2, 2)],
  },
  {
    id: "quad",
    label: "Quad",
    kind: "grid",
    capacity: 4,
    cols: 2,
    rows: 2,
    cells: [g(1, 1), g(2, 1), g(1, 2), g(2, 2)],
  },
  {
    id: "six",
    label: "Six-up",
    kind: "grid",
    capacity: 6,
    cols: 3,
    rows: 2,
    cells: [g(1, 1), g(2, 1), g(3, 1), g(1, 2), g(2, 2), g(3, 2)],
  },
  {
    id: "nine",
    label: "Nine-up",
    kind: "grid",
    capacity: 9,
    cols: 3,
    rows: 3,
    cells: Array.from({ length: 9 }, (_, i) => g((i % 3) + 1, Math.floor(i / 3) + 1)),
  },
  {
    id: "mosaic",
    label: "Mosaic",
    kind: "grid",
    capacity: 6,
    cols: 3,
    rows: 3,
    // Hero 2×2 with a wrapping L of singles — a magazine spread.
    cells: [g(1, 1, 2, 2), g(3, 1), g(3, 2), g(1, 3), g(2, 3), g(3, 3)],
  },
  { id: "polaroid", label: "Polaroid stack", kind: "polaroid", capacity: 3 },
  { id: "filmstrip", label: "Filmstrip", kind: "filmstrip", capacity: 4 },
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
];

export function layoutsForRatio(ratioId: RatioId): CollageLayout[] {
  return LAYOUTS.filter((l) => !l.ratios || l.ratios.includes(ratioId));
}

export function layoutById(id: string): CollageLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS.find((l) => l.id === "quad")!;
}

export type CollageTheme = {
  id: string;
  label: string;
  /** Canvas background + frame + caption colours, as CSS var references. */
  bg: string;
  frame: string;
  ink: string;
  accent: string;
};

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

export function themeById(id: string): CollageTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export type CollageMotif = "plain" | "wash" | "garland" | "phera" | "doli";

export const MOTIFS: { id: CollageMotif; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "wash", label: "Marigold wash" },
  { id: "garland", label: "Garland" },
  { id: "phera", label: "Phera" },
  { id: "doli", label: "Doli" },
];

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

export type CollagePreset = {
  hashtag: string;
  caption: string;
  layoutId: string;
  themeId: string;
  motif: CollageMotif;
};

/**
 * Shareable one-tap bundles. Hashtags are kept literal (they double as the
 * caption tag). Applying a preset seeds layout + theme + caption but leaves
 * everything editable afterwards.
 */
export const PRESETS: CollagePreset[] = [
  { hashtag: "#MyFamily", caption: "My people, all in one frame", layoutId: "quad", themeId: "wine", motif: "garland" },
  { hashtag: "#OurWedding", caption: "The day we said forever", layoutId: "mosaic", themeId: "blush", motif: "wash" },
  { hashtag: "#BehenKiWedding", caption: "My sister's big day", layoutId: "polaroid", themeId: "gold", motif: "plain" },
  { hashtag: "#CousinKiShaadi", caption: "Cousin crew, wedding mode", layoutId: "six", themeId: "rose", motif: "wash" },
  { hashtag: "#BhaiBehen", caption: "Bhai-behen forever", layoutId: "duo", themeId: "wine", motif: "garland" },
  { hashtag: "#Cousins", caption: "The whole cousin gang", layoutId: "filmstrip", themeId: "blush", motif: "plain" },
  { hashtag: "#ShubhVivah", caption: "Shubh Vivah", layoutId: "mosaic", themeId: "gold", motif: "garland" },
  { hashtag: "#SaatPhere", caption: "Saat phere, one lifetime", layoutId: "six", themeId: "wine", motif: "wash" },
  { hashtag: "#JaiJinendra", caption: "Jai Jinendra", layoutId: "nine", themeId: "ivory", motif: "plain" },
];

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
