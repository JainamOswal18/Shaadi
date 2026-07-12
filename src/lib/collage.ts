/**
 * Collage maker configuration: layout variants, colour themes, background
 * motifs, and the shareable hashtag presets. Kept declarative so the editor UI
 * and the rendered canvas stay in sync from one source of truth.
 */

export type Cell = { col: number; row: number; colSpan: number; rowSpan: number };

export type CollageLayout = {
  id: string;
  label: string;
  /** How many photos this layout holds. */
  capacity: number;
  /** "grid" layouts use `cols`/`rows`/`cells`; others render bespoke frames. */
  kind: "grid" | "polaroid" | "filmstrip";
  cols?: number;
  rows?: number;
  cells?: Cell[];
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
];

export function layoutById(id: string): CollageLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[2];
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
    id: "maroon",
    label: "Maroon",
    bg: "var(--maroon)",
    frame: "var(--gold)",
    ink: "var(--cream)",
    accent: "var(--marigold)",
  },
  {
    id: "cream",
    label: "Ivory",
    bg: "var(--cream)",
    frame: "var(--marigold-deep)",
    ink: "var(--maroon)",
    accent: "var(--marigold-deep)",
  },
  {
    id: "marigold",
    label: "Marigold",
    bg: "var(--marigold-deep)",
    frame: "var(--cream)",
    ink: "var(--cream)",
    accent: "var(--gold)",
  },
  {
    id: "gold",
    label: "Gold",
    bg: "var(--gold)",
    frame: "var(--maroon)",
    ink: "var(--maroon)",
    accent: "var(--maroon)",
  },
  {
    id: "henna",
    label: "Henna",
    bg: "var(--henna)",
    frame: "var(--cream)",
    ink: "var(--cream)",
    accent: "var(--gold)",
  },
];

export function themeById(id: string): CollageTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export type CollageMotif = "plain" | "wash" | "garland";

export const MOTIFS: { id: CollageMotif; label: string }[] = [
  { id: "plain", label: "Plain" },
  { id: "wash", label: "Marigold wash" },
  { id: "garland", label: "Garland" },
];

export type CollageStyle = {
  layoutId: string;
  themeId: string;
  motif: CollageMotif;
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
  { hashtag: "#MyFamily", caption: "My people, all in one frame", layoutId: "quad", themeId: "maroon", motif: "garland" },
  { hashtag: "#OurWedding", caption: "The day we said forever", layoutId: "mosaic", themeId: "marigold", motif: "wash" },
  { hashtag: "#BehenKiWedding", caption: "My sister's big day", layoutId: "polaroid", themeId: "gold", motif: "plain" },
  { hashtag: "#CousinKiShaadi", caption: "Cousin crew, wedding mode", layoutId: "six", themeId: "henna", motif: "wash" },
  { hashtag: "#BhaiBehen", caption: "Bhai-behen forever", layoutId: "duo", themeId: "maroon", motif: "garland" },
  { hashtag: "#Cousins", caption: "The whole cousin gang", layoutId: "filmstrip", themeId: "marigold", motif: "plain" },
  { hashtag: "#ShubhVivah", caption: "Shubh Vivah", layoutId: "mosaic", themeId: "gold", motif: "garland" },
  { hashtag: "#SaatPhere", caption: "Saat phere, one lifetime", layoutId: "six", themeId: "maroon", motif: "wash" },
  { hashtag: "#JaiJinendra", caption: "Jai Jinendra", layoutId: "nine", themeId: "cream", motif: "plain" },
];

export const DEFAULT_STYLE: CollageStyle = {
  layoutId: "quad",
  themeId: "maroon",
  motif: "wash",
  border: 6,
  radius: 14,
  caption: "Nameeta ki Shaadi",
  hashtag: "#SaatPhere",
};

/** Fixed export size — square, social-friendly, high-res at pixelRatio 2. */
export const CANVAS_SIZE = 1080;
