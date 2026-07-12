# Jeena — Foundation & Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the app to **Jeena** with the **Rose Gold & Wine (light)** palette, a cute couple **favicon**, a **JEENA** caps wordmark, a **cinematic framer-motion intro**, a **tap-to-open selfie tray** (camera / gallery), and warmer **upload copy** — a complete visual refresh that ships on its own.

**Architecture:** Next.js 15 App Router + React 19 + Tailwind v4 (CSS custom-property tokens in `globals.css`). Brand colours are token-driven, so most components inherit the new palette for free. Icons are file-based (App Router auto-detects `app/icon.svg` / `app/apple-icon.png`). Motion uses framer-motion (already a dependency).

**Tech Stack:** Next.js 15.5, React 19, Tailwind v4, framer-motion 12, base-ui, lucide-react, sharp (icon rasterisation), vitest + @testing-library/react, Playwright.

## Global Constraints

- **English only.** No Devanagari anywhere. Remove the Tiro Devanagari font and the `शादी` / `जीना` marks.
- **Palette = Rose Gold & Wine (light).** Source-of-truth hexes: `--cream #FAF3EE`, `--card #FFFAF6`, `--marigold #D98A6E`, `--marigold-deep #A85462`, `--gold #C9A24B`, `--maroon #5A1F2B`, `--rose #C97B84`, `--rose-soft #EAD1CE`, `--henna #8A8A6A`, foreground `#3A1620`, muted-foreground `#98727A`, border/input `#ECD9D4`, ring `#C97B84`.
- **Wordmark:** `JEENA` — Fraunces 600, uppercase, `letter-spacing: 0.18em`, colour `--maroon`. Large sizes add subline "Est. 2026 · Forever" (small caps, `letter-spacing: 0.3em`, `--marigold-deep`).
- **Tagline:** "two hearts, one beginning".
- **Title:** `Our Wedding · Jeena`.
- **Upload prompt:** "Add your photos to the story." + "Contribute the amazing shots you took — they get face-matched into everyone's gallery too."
- **Intro ambiance:** marigold petals + hearts; framer-motion; `prefers-reduced-motion` disables all motion (content still reveals via opacity).
- **Accessibility:** 44px min touch targets; visible focus rings; AA 4.5:1 — verify `--marigold-deep` + white on buttons, darken toward `#9E4A58` if it fails.
- **Commits:** conventional commits, one per task.
- Package manager is **pnpm**. Dev: `pnpm dev`. Unit tests: `pnpm test`. E2E: `pnpm exec playwright test`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/icon.svg` (create) | Cute illustrated couple, primary scalable favicon |
| `src/app/apple-icon.png` (create) | 180×180 raster icon (generated from SVG) |
| `src/app/favicon.ico` (delete) | Removed in favour of file-based icons |
| `scripts/gen-icons.mjs` (create) | One-off sharp rasteriser: `icon.svg` → PNGs |
| `src/app/globals.css` (modify) | Palette tokens (`:root`, `.dark`), `--rose` mapping, shadows |
| `src/app/layout.tsx` (modify) | Drop Tiro font; title/description/themeColor |
| `src/components/Brand.tsx` (modify) | JEENA wordmark; remove Devanagari |
| `src/app/page.tsx` (modify) | Hero tagline + upload-prompt copy |
| `src/app/upload/page.tsx` (modify) | Palette/copy polish |
| `src/components/SelfieCapture.tsx` (modify) | Tap-to-open camera/gallery tray |
| `src/components/MagazineIntro.tsx` (modify) | Cinematic reveal + petals/hearts; drop Devanagari |
| Tests under `tests/` | Component + e2e coverage per task |

---

### Task 1: Couple favicon (icon.svg + raster generation)

**Files:**
- Create: `src/app/icon.svg`
- Create: `scripts/gen-icons.mjs`
- Create: `src/app/apple-icon.png` (generated)
- Delete: `src/app/favicon.ico`

**Interfaces:**
- Produces: file-based icons auto-served by Next.js App Router. No code imports.

- [ ] **Step 1: Create the SVG icon**

Create `src/app/icon.svg` — a wine rounded-square with a cute bride + groom, readable at 16px:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="Jeena — Nameeta and Jeenendra">
  <rect width="64" height="64" rx="15" fill="#5A1F2B"/>
  <!-- Groom (left) -->
  <g>
    <path d="M14 27a11 11 0 0 1 22 0v3a11 11 0 0 1-22 0z" fill="#F4D9CE"/>
    <path d="M13.5 27a11.5 11.5 0 0 1 23 0c-3-2-6-3-11.5-3S16.5 25 13.5 27z" fill="#2A0E15"/>
    <path d="M20 24l5-3 5 3a12 12 0 0 0-10 0z" fill="#C9A24B"/>
    <circle cx="21" cy="30" r="1.4" fill="#3A1620"/>
    <circle cx="29" cy="30" r="1.4" fill="#3A1620"/>
    <path d="M22 34q3 2 6 0" stroke="#8A4A3A" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </g>
  <!-- Bride (right) -->
  <g>
    <path d="M30 29a11 11 0 0 1 22 0v3a11 11 0 0 1-22 0z" fill="#F7E0D6"/>
    <path d="M29.5 29a11.5 11.5 0 0 1 23 0c0 4-2 7-2 7l-2-6-7-3-7 3-2 6s-3-3-3-7z" fill="#2A0E15"/>
    <circle cx="41" cy="24.5" r="1.6" fill="#C9A24B"/>
    <circle cx="37" cy="32" r="1.4" fill="#3A1620"/>
    <circle cx="45" cy="32" r="1.4" fill="#3A1620"/>
    <path d="M39 36q2 1.6 4 0" stroke="#B85C6A" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="33.5" cy="33" r="1.3" fill="#C9A24B"/>
    <circle cx="48.5" cy="33" r="1.3" fill="#C9A24B"/>
  </g>
  <!-- Little gold heart -->
  <path d="M32 49c-3-2.4-6-4.2-6-7a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 2.8-3 4.6-6 7z" fill="#C9A24B"/>
</svg>
```

- [ ] **Step 2: Create the raster generation script**

Create `scripts/gen-icons.mjs`:

```js
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "src/app/icon.svg"));

await sharp(svg, { density: 384 })
  .resize(180, 180)
  .png()
  .toFile(join(root, "src/app/apple-icon.png"));

console.log("Wrote src/app/apple-icon.png");
```

- [ ] **Step 3: Generate the PNG and remove the old favicon**

Run:
```bash
pnpm exec node scripts/gen-icons.mjs
rm -f src/app/favicon.ico
```
Expected: prints `Wrote src/app/apple-icon.png`; `src/app/apple-icon.png` exists.

- [ ] **Step 4: Verify Next serves the icons**

Run `pnpm dev`, then:
```bash
curl -sI http://localhost:3000/icon.svg | head -n1
curl -sI http://localhost:3000/apple-icon.png | head -n1
```
Expected: both return `HTTP/1.1 200 OK`. Open `http://localhost:3000` and confirm the wine couple icon shows in the browser tab.

- [ ] **Step 5: Commit**

```bash
git add src/app/icon.svg src/app/apple-icon.png scripts/gen-icons.mjs
git add -u src/app/favicon.ico
git commit -m "feat(brand): add cute couple favicon (icon.svg + apple-icon)"
```

---

### Task 2: Rose Gold & Wine palette tokens

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: CSS custom properties consumed by every component via Tailwind (`text-maroon`, `bg-marigold-deep`, `text-rose`, etc.). Adds `--rose` / `--rose-soft` and their `--color-rose` / `--color-rose-soft` theme mappings.

- [ ] **Step 1: Add the rose theme mappings**

In `globals.css`, inside `@theme inline { ... }`, next to the existing brand-token block (`--color-marigold`, etc.), add:

```css
  --color-rose: var(--rose);
  --color-rose-soft: var(--rose-soft);
```

- [ ] **Step 2: Replace the `:root` palette**

Replace the whole `:root { ... }` block's colour values with the Rose Gold & Wine (light) set (keep `--radius: 0.75rem`):

```css
:root {
  /* Rose Gold & Wine — light */
  --cream: #FAF3EE;
  --marigold: #D98A6E;
  --marigold-deep: #A85462;
  --gold: #C9A24B;
  --maroon: #5A1F2B;
  --rose: #C97B84;
  --rose-soft: #EAD1CE;
  --henna: #8A8A6A;

  --background: #FAF3EE;
  --foreground: #3A1620;
  --card: #FFFAF6;
  --card-foreground: #3A1620;
  --popover: #FFFAF6;
  --popover-foreground: #3A1620;
  --primary: #5A1F2B;
  --primary-foreground: #FDF0EC;
  --secondary: #F3E1DB;
  --secondary-foreground: #5A1F2B;
  --muted: #F1E4DF;
  --muted-foreground: #98727A;
  --accent: #F5E1D9;
  --accent-foreground: #7A2E3A;
  --destructive: #B23A48;
  --border: #ECD9D4;
  --input: #ECD9D4;
  --ring: #C97B84;
  --chart-1: #D98A6E;
  --chart-2: #A85462;
  --chart-3: #C9A24B;
  --chart-4: #8A8A6A;
  --chart-5: #C97B84;
  --radius: 0.75rem;
  --sidebar: #F6EEE8;
  --sidebar-foreground: #3A1620;
  --sidebar-primary: #5A1F2B;
  --sidebar-primary-foreground: #FDF0EC;
  --sidebar-accent: #F5E1D9;
  --sidebar-accent-foreground: #7A2E3A;
  --sidebar-border: #ECD9D4;
  --sidebar-ring: #C97B84;
}
```

- [ ] **Step 3: Replace the `.dark` palette**

Replace the `.dark { ... }` colour values with the Rose Gold & Wine · Dark variant:

```css
.dark {
  --cream: #241019;
  --marigold: #D98A6E;
  --marigold-deep: #A85462;
  --gold: #D6B25E;
  --maroon: #F4DEDA;
  --rose: #D98A93;
  --rose-soft: #522530;
  --henna: #A9BBA0;

  --background: #241019;
  --foreground: #F1E4DF;
  --card: #331722;
  --card-foreground: #F1E4DF;
  --popover: #331722;
  --popover-foreground: #F1E4DF;
  --primary: #D98A6E;
  --primary-foreground: #241019;
  --secondary: #3A1C26;
  --secondary-foreground: #F1E4DF;
  --muted: #33191F;
  --muted-foreground: #C29AA0;
  --accent: #43222C;
  --accent-foreground: #F1E4DF;
  --destructive: #C65C68;
  --border: rgba(232,206,178,0.26);
  --input: rgba(232,206,178,0.30);
  --ring: #D98A93;
  --chart-1: #D98A6E;
  --chart-2: #C97B84;
  --chart-3: #D6B25E;
  --chart-4: #A9BBA0;
  --chart-5: #D98A93;
  --sidebar: #331722;
  --sidebar-foreground: #F1E4DF;
  --sidebar-primary: #D98A6E;
  --sidebar-primary-foreground: #241019;
  --sidebar-accent: #43222C;
  --sidebar-accent-foreground: #F1E4DF;
  --sidebar-border: rgba(232,206,178,0.26);
  --sidebar-ring: #D98A93;
}
```

- [ ] **Step 4: Update the shadow hue to wine**

In `@theme inline`, replace the two shadow definitions (currently `oklch(0.36 0.115 18 / …)`) with wine-tinted shadows:

```css
  --shadow-card: 0 1px 2px rgba(90,31,43,0.06),
    0 8px 24px -12px rgba(90,31,43,0.18);
  --shadow-float: 0 12px 40px -14px rgba(90,31,43,0.28);
```

- [ ] **Step 5: Verify visually**

Run `pnpm dev`, open `http://localhost:3000`. Expected: ivory background, wine headings, rose-gold/deep-rose buttons, gold garland. No leftover orange marigold.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(brand): Rose Gold & Wine palette tokens + rose accent"
```

---

### Task 3: Fonts & document metadata

**Files:**
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces: page `<title>` = "Our Wedding · Jeena"; removes `--font-tiro` / `--font-devanagari` from the DOM.

- [ ] **Step 1: Remove the Tiro font and update metadata**

In `layout.tsx`: delete the `Tiro_Devanagari_Hindi` import and its `tiro` config; remove `${tiro.variable}` from the `<body>` className. Update:

```tsx
export const metadata: Metadata = {
  title: "Our Wedding · Jeena",
  description:
    "Nameeta & Jeenendra's wedding, in one place. Snap a selfie to find every photo you're in — relive, collage, and keep the memories.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF3EE",
};
```

Keep the `Fraunces` and `Hanken_Grotesk` imports and their variables.

- [ ] **Step 2: Remove the devanagari theme font mapping**

In `globals.css` `@theme inline`, delete the line `--font-devanagari: var(--font-tiro), ui-serif, serif;` (no longer referenced).

- [ ] **Step 3: Add a Playwright title smoke test**

Create `tests/e2e/brand.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("home has the Jeena title and no Devanagari", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Our Wedding · Jeena/);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("शादी");
  expect(body).not.toContain("जीना");
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec playwright test tests/e2e/brand.spec.ts`
Expected: PASS (dev server auto-started per `playwright.config.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css tests/e2e/brand.spec.ts
git commit -m "feat(brand): Jeena metadata; drop Tiro Devanagari font"
```

---

### Task 4: JEENA wordmark

**Files:**
- Modify: `src/components/Brand.tsx`
- Test: `tests/components/Brand.test.tsx` (create)

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces: `<Brand size?, href?, className?, withEst?>` rendering `JEENA` caps. Removes the `withDevanagari` prop.

- [ ] **Step 1: Write the failing test**

Create `tests/components/Brand.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Brand } from "@/components/Brand";

describe("Brand", () => {
  it("renders the JEENA wordmark with no Devanagari", () => {
    render(<Brand href={null} />);
    expect(screen.getByText("JEENA")).toBeInTheDocument();
    expect(screen.queryByText("शादी")).not.toBeInTheDocument();
  });

  it("shows the est. subline only at large size", () => {
    const { rerender } = render(<Brand href={null} size="lg" withEst />);
    expect(screen.getByText(/Est\. 2026/)).toBeInTheDocument();
    rerender(<Brand href={null} size="sm" />);
    expect(screen.queryByText(/Est\. 2026/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/Brand.test.tsx`
Expected: FAIL (Brand still renders "Shaadi" / has `withDevanagari`).

- [ ] **Step 3: Rewrite `Brand.tsx`**

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Jeena wordmark — "JEENA" set in Fraunces caps, letterspaced, with an
 * optional "Est. 2026 · Forever" subline for large placements.
 */
export function Brand({
  className,
  size = "md",
  href = "/",
  withEst = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  withEst?: boolean;
}) {
  const sizes = {
    sm: "text-lg",
    md: "text-xl sm:text-2xl",
    lg: "text-3xl sm:text-4xl",
  } as const;

  const content = (
    <span className="inline-flex flex-col items-center">
      <span
        className={cn(
          "font-heading font-semibold uppercase text-maroon",
          "tracking-[0.18em]",
          sizes[size],
        )}
      >
        Jeena
      </span>
      {withEst && size === "lg" && (
        <span className="mt-1 text-[0.6rem] font-medium uppercase tracking-[0.3em] text-marigold-deep">
          Est. 2026 · Forever
        </span>
      )}
    </span>
  );

  if (href === null) {
    return <span className={cn("inline-flex", className)}>{content}</span>;
  }

  return (
    <Link
      href={href}
      aria-label="Jeena — home"
      className={cn(
        "inline-flex rounded-lg focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
        className,
      )}
    >
      {content}
    </Link>
  );
}
```

Note: the `<span>` renders the text `Jeena`; the `uppercase` class makes it read `JEENA` while keeping the accessible/queryable text — **update the test to `getByText("Jeena")`** if your setup normalises case (Testing Library matches the DOM text `Jeena`). Prefer `screen.getByText("Jeena")` in Step 1 to match the un-transformed DOM text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/components/Brand.test.tsx`
Expected: PASS. (If it fails on case, switch the assertion to `getByText("Jeena")`.)

- [ ] **Step 5: Fix any callers using `withDevanagari`**

Run: `grep -rn "withDevanagari" src/` — expected: no results. If any exist, remove the prop.

- [ ] **Step 6: Commit**

```bash
git add src/components/Brand.tsx tests/components/Brand.test.tsx
git commit -m "feat(brand): JEENA caps wordmark, remove Devanagari"
```

---

### Task 5: Home hero tagline + upload-prompt copy

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `Brand` (Task 4). Produces: no new exports.

- [ ] **Step 1: Add the tagline under the hero heading**

In `page.tsx`, the hero `<section>` currently has the eyebrow chip "Nameeta weds Jeenendra" and an `<h1>`. Directly under the `<h1>`, add the tagline line:

```tsx
<p className="mt-2 font-heading text-base italic text-rose">
  two hearts, one beginning
</p>
```

- [ ] **Step 2: Rewrite the upload-prompt block**

Replace the dashed "Have photos on your phone from the day?" block near the bottom of `page.tsx` with:

```tsx
<div className="mt-5 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-4 text-center">
  <p className="font-heading text-base text-maroon">Add your photos to the story.</p>
  <p className="max-w-sm text-sm text-muted-foreground">
    Contribute the amazing shots you took — they get face-matched into everyone&rsquo;s gallery too.
  </p>
  <Link
    href="/upload"
    className="mt-1 inline-flex min-h-11 items-center gap-1.5 font-medium text-maroon underline-offset-4 hover:underline"
  >
    <ImagePlus className="size-4 text-marigold-deep" /> Add to the shared album
  </Link>
</div>
```

- [ ] **Step 3: Update the footer line**

Replace the footer text with:

```tsx
<footer className="mt-auto pt-10 text-center text-xs text-muted-foreground">
  Made with love for Nameeta &amp; Jeenendra&rsquo;s big day.
</footer>
```

- [ ] **Step 4: Verify**

Run `pnpm dev`, open `/`. Expected: tagline "two hearts, one beginning" under the hero; new upload-prompt copy. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): Jeena tagline + warmer upload-prompt copy"
```

---

### Task 6: Selfie capture tray (camera / gallery)

**Files:**
- Modify: `src/components/SelfieCapture.tsx`
- Test: `tests/components/SelfieCapture.test.tsx` (create)

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button`, `cn`.
- Produces: unchanged public API `SelfieCapture({ onChange })`. Internally adds a tray with two actions; idle state box is a button that opens the tray.

- [ ] **Step 1: Write the failing test**

Create `tests/components/SelfieCapture.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SelfieCapture } from "@/components/SelfieCapture";

describe("SelfieCapture tray", () => {
  it("opens a tray with camera and gallery options when the box is tapped", () => {
    render(<SelfieCapture onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("selfie-box"));
    expect(screen.getByTestId("tray-camera")).toBeInTheDocument();
    expect(screen.getByTestId("tray-gallery")).toBeInTheDocument();
  });

  it("gallery option triggers the file input", () => {
    render(<SelfieCapture onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("selfie-box"));
    const input = screen.getByLabelText("Upload a selfie photo") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByTestId("tray-gallery"));
    expect(clickSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/SelfieCapture.test.tsx`
Expected: FAIL (`selfie-box` / `tray-camera` testids don't exist).

- [ ] **Step 3: Add tray state + testid to the idle box**

In `SelfieCapture.tsx`: add `const [trayOpen, setTrayOpen] = useState(false);`. On the outer box `div` (the `aspect-square` container), when in idle/denied/error state make it act as a button:

```tsx
<div
  data-testid="selfie-box"
  role={mode === "idle" || mode === "denied" || mode === "error" ? "button" : undefined}
  tabIndex={mode === "idle" || mode === "denied" || mode === "error" ? 0 : undefined}
  onClick={() => {
    if (mode === "idle" || mode === "denied" || mode === "error") setTrayOpen(true);
  }}
  onKeyDown={(e) => {
    if ((e.key === "Enter" || e.key === " ") && (mode === "idle" || mode === "denied" || mode === "error")) {
      e.preventDefault();
      setTrayOpen(true);
    }
  }}
  className={cn(
    "relative aspect-square w-full overflow-hidden rounded-2xl border border-border bg-invitation",
    "grid place-items-center text-center",
    (mode === "idle" || mode === "denied" || mode === "error") &&
      "cursor-pointer focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
  )}
  data-selfie-state={mode}
>
```

- [ ] **Step 4: Render the tray sheet**

Inside the box (after the existing idle/message content), add the bottom-sheet tray:

```tsx
{trayOpen && (
  <>
    <div
      className="absolute inset-0 z-10 bg-maroon/25"
      onClick={(e) => {
        e.stopPropagation();
        setTrayOpen(false);
      }}
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a selfie"
      className="absolute inset-x-3 bottom-3 z-20 overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-[var(--shadow-float)]"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="touch"
        data-testid="tray-camera"
        className="w-full justify-start text-maroon"
        onClick={() => {
          setTrayOpen(false);
          void startCamera();
        }}
      >
        <Camera /> Take a selfie
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="touch"
        data-testid="tray-gallery"
        className="w-full justify-start border-t border-border text-maroon"
        onClick={() => {
          setTrayOpen(false);
          fileRef.current?.click();
        }}
      >
        <Upload /> Choose from gallery
      </Button>
    </div>
  </>
)}
```

Keep the existing hidden file `<input>` (remove its `capture="user"` attribute so the gallery is offered) and keep the existing secondary button row for the live/captured states.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/components/SelfieCapture.test.tsx`
Expected: PASS.

- [ ] **Step 6: Manual device check**

Run `pnpm dev`, open `/` on a phone (or responsive mode). Tap the selfie box → tray slides up → "Take a selfie" opens camera; "Choose from gallery" opens the picker. Escape/scrim dismiss.

- [ ] **Step 7: Commit**

```bash
git add src/components/SelfieCapture.tsx tests/components/SelfieCapture.test.tsx
git commit -m "feat(selfie): tap-to-open camera/gallery tray"
```

---

### Task 7: Cinematic intro (framer-motion reveal + petals/hearts)

**Files:**
- Modify: `src/components/MagazineIntro.tsx`
- Test: `tests/components/MagazineIntro.test.tsx` (create)

**Interfaces:**
- Consumes: `Garland`, `Button`, framer-motion, `useReducedMotion`.
- Produces: unchanged export `MagazineIntro({ onDone })` and `INTRO_SEEN_KEY`. Removes the Devanagari kicker; renames the couple line to English; adds staggered reveal + ambient particles.

- [ ] **Step 1: Write the failing test**

Create `tests/components/MagazineIntro.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MagazineIntro, INTRO_SEEN_KEY } from "@/components/MagazineIntro";

describe("MagazineIntro", () => {
  beforeEach(() => localStorage.clear());

  it("has no Devanagari kicker", () => {
    render(<MagazineIntro onDone={vi.fn()} />);
    expect(screen.queryByText(/शादी|जीना/)).not.toBeInTheDocument();
  });

  it("Skip marks the intro seen and calls onDone", () => {
    const onDone = vi.fn();
    render(<MagazineIntro onDone={onDone} />);
    fireEvent.click(screen.getByTestId("intro-skip"));
    expect(onDone).toHaveBeenCalled();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/MagazineIntro.test.tsx`
Expected: FAIL (panels still contain the Devanagari kicker `Nameeta ki Shaadi`).

- [ ] **Step 3: Update panel content (English, Jeena)**

In `MagazineIntro.tsx`, change the `PANELS` array so no panel uses Devanagari or a `kicker` in `--font-devanagari`. Replace with:

```tsx
const PANELS: Panel[] = [
  {
    eyebrow: "The Wedding Issue · 2026",
    title: (
      <>
        Nameeta <span className="italic text-marigold-deep">weds</span> Jeenendra
      </>
    ),
    kicker: "two hearts, one beginning",
    body: "We've kept your moments safe — let me share them with you.",
  },
  {
    eyebrow: "#SaatPhere",
    title: (
      <>
        Seven vows,
        <br />a thousand frames.
      </>
    ),
    body: "Every glance, every laugh, every stolen candid — gathered in one warm album.",
  },
  {
    eyebrow: "Your gallery is ready",
    title: (
      <>
        Find <span className="italic">yourself</span> in the celebration.
      </>
    ),
    body: "One quick selfie is all it takes to unwrap your photos.",
  },
];
```

Change the kicker render (currently `font-[family-name:var(--font-devanagari)]`) to:

```tsx
{panel.kicker && (
  <p className="mt-3 font-heading text-base italic text-rose">
    {panel.kicker}
  </p>
)}
```

Change the masthead word `Shaadi` in the top bar to `Jeena` (keep the marigold dot styling).

- [ ] **Step 4: Add staggered reveal to the active panel**

Wrap the panel's inner children in a framer-motion stagger. Replace the panel content `motion.div` children container with a `variants`-driven parent so eyebrow → garland → title → kicker → body rise in sequence:

```tsx
const container = {
  hidden: {},
  show: reduce ? {} : { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const item = reduce
  ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
  : {
      hidden: { opacity: 0, y: 18 },
      show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
    };
```

Apply `variants={container} initial="hidden" animate="show"` to the panel content wrapper, and `variants={item}` to each of the eyebrow `<p>`, the `<Garland>` wrapper, the `<h1>`, the kicker `<p>`, and the body `<p>` (wrap each in `motion.p` / `motion.div`).

- [ ] **Step 5: Add ambient petals + hearts**

Add a decorative particle layer inside the root overlay (above the wash, below the frame), disabled under reduced motion:

```tsx
{!reduce && (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
    {Array.from({ length: 18 }).map((_, i) => {
      const left = (i * 53) % 100;
      const delay = (i % 6) * 0.4;
      const dur = 4 + (i % 5);
      const isHeart = i % 4 === 0;
      return (
        <motion.span
          key={i}
          className={cn(
            "absolute -top-6 text-marigold",
            isHeart && "text-rose",
          )}
          style={{ left: `${left}%` }}
          initial={{ y: -20, opacity: 0, rotate: 0 }}
          animate={{ y: "110vh", opacity: [0, 0.9, 0], rotate: 320 }}
          transition={{ duration: dur, delay, repeat: Infinity, ease: "easeIn" }}
        >
          {isHeart ? "♥" : "❀"}
        </motion.span>
      );
    })}
  </div>
)}
```

Ensure `cn` is imported (it already is).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test tests/components/MagazineIntro.test.tsx`
Expected: PASS.

- [ ] **Step 7: Manual check (motion + reduced motion)**

Run `pnpm dev`, clear localStorage, reload `/`: intro reveals with stagger and drifting petals/hearts. Then enable OS "Reduce Motion" and reload: content appears without motion, no drifting particles.

- [ ] **Step 8: Commit**

```bash
git add src/components/MagazineIntro.tsx tests/components/MagazineIntro.test.tsx
git commit -m "feat(intro): cinematic staggered reveal + petals/hearts, English copy"
```

---

### Task 8: Upload page polish

**Files:**
- Modify: `src/app/upload/page.tsx`
- Modify: `src/components/UploadDropzone.tsx`

**Interfaces:**
- Consumes: `Brand`, `QuotaBar`, `UploadDropzone` (all existing). No API changes.

- [ ] **Step 1: Refresh the upload page heading/intro copy**

In `upload/page.tsx`, update the `<h1>`/intro paragraph to match the new voice (keep structure, quotas, and the `MAX` limits):

```tsx
<h1 className="mt-1 font-heading text-2xl font-semibold text-maroon sm:text-3xl">
  Add your photos to the story
</h1>
<p className="max-w-md text-sm text-muted-foreground">
  Share the shots you caught from the day — every photo helps another guest find
  themselves in the celebration.
</p>
```

- [ ] **Step 2: Warm the dropzone empty copy**

In `UploadDropzone.tsx`, update the dropzone heading/subtext:

```tsx
<p className="font-heading text-lg font-semibold text-maroon">Drop your memories here</p>
<p className="mt-1 text-sm text-muted-foreground">
  Tap to choose, or drag files in. Up to {remaining.photos} photos and {remaining.videos} videos.
</p>
```

- [ ] **Step 3: Verify**

Run `pnpm dev`, open `/upload`. Expected: new copy, palette applied, quota bar renders, drag/drop still works.

- [ ] **Step 4: Commit**

```bash
git add src/app/upload/page.tsx src/components/UploadDropzone.tsx
git commit -m "feat(upload): warmer copy + palette polish"
```

---

### Task 9: Full regression + review gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `pnpm test`
Expected: all tests pass (existing + new Brand/Selfie/Intro tests).

- [ ] **Step 2: Run e2e**

Run: `pnpm exec playwright test`
Expected: brand smoke + existing e2e pass.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: successful production build, no type errors.

- [ ] **Step 4: Visual sweep**

Open `/`, `/results` (via a search or a known sid), `/upload`, `/admin/login`. Confirm: wine/rose palette everywhere, JEENA wordmark, couple favicon in the tab, intro animates, selfie tray works, no orange marigold or Devanagari remnants.

- [ ] **Step 5: Contrast check**

Verify `--marigold-deep` (`#A85462`) with white button text meets AA 4.5:1. If it fails, set `--marigold-deep: #9E4A58` in both `:root` and the button usages, re-verify, and commit `fix(a11y): bump button contrast to AA`.

---

## Self-review notes (author)

- **Spec coverage:** Rebrand (Tasks 3,4,5) · Palette (Task 2) · Selfie tray (Task 6) · Upload copy (Tasks 5,8) · Intro (Task 7) · Favicon feature H (Task 1). Collage 2.0 and Reel maker are intentionally **out of scope for this plan** (Plans 2 and 3).
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `Brand` prop `withDevanagari` removed and replaced by `withEst` (Task 4); no caller depends on the old prop (Task 4 Step 5 greps to confirm). `INTRO_SEEN_KEY` unchanged. `SelfieCapture({ onChange })` signature unchanged.
- **Follow-on:** Plans 2 (Collage 2.0) and 3 (Reel maker) to be written next; both depend on the `--rose` token and JEENA brand landing here first.
