# Jeena — Rebrand & Feature Revamp (Design Spec)

**Date:** 2026-07-12
**Status:** Draft for review
**Scope:** One comprehensive spec covering rebrand, palette, upload UX, selfie tray, collage 2.0, reel maker, and cinematic intro. Build order chosen by the user: **all in one spec**.

---

## 1. Overview & goals

Rebrand the deployed wedding photo app ("Shaadi") to **Jeena**, refresh the palette to **Rose Gold & Wine (light)**, and ship a set of UX upgrades: a tap-to-open selfie tray, warmer upload flow, an Instagram-ready and adjustable collage maker, a brand-new photo→video **reel maker** with bundled music, and a cinematic animated intro.

Non-goals: changing the face-recognition pipeline, the R2 storage model, or the admin console's core function. Those are touched only where a feature requires it (e.g. reel render service, minor palette in admin).

### Locked decisions (from lookbook review)

| Choice | Value |
|---|---|
| Palette | **Rose Gold & Wine — light** |
| Wordmark | **"JEENA"** — all-caps Fraunces, letterspaced, with an "Est. 2026 · Forever" subline in large placements |
| Tagline | **"two hearts, one beginning"** |
| Rose accent | Dusty rose `#C97B84` |
| Upload prompt copy | **"Add your photos to the story."** + "Contribute the amazing shots you took — they get face-matched into everyone's gallery too." |
| Intro ambiance | Marigold **petals + hearts**, framer-motion (not Locomotive) |
| Collage default aspect | **4:5** (with 1:1 and 9:16 options) |
| Music (reel) | **Curated, bundled songs** provided by the host; trim-to-clip. No third-party music API. |
| Reel render | **Server-side ffmpeg**; frames pulled from the already-compressed R2 previews (down-res to ~90% quality as needed). |
| Language | **English only** — no Devanagari anywhere (remove शादी / जीना and the Tiro Devanagari font). |

---

## 2. Design system

### 2.1 Palette — Rose Gold & Wine (light)

Brand tokens (source of truth = these hexes; expressed in `globals.css` as `oklch()` to match the existing file convention). Replaces the current marigold/maroon set.

| Token | Hex | Role |
|---|---|---|
| `--cream` (background) | `#FAF3EE` | page background (ivory) |
| `--card` | `#FFFAF6` | card / surface |
| `--marigold` | `#D98A6E` | warm rose-gold accent |
| `--marigold-deep` | `#A85462` | primary action / deep rose (buttons) |
| `--gold` | `#C9A24B` | metallic hairlines, garland thread |
| `--maroon` | `#5A1F2B` | headings, brand ink (wine) |
| `--rose` *(new token)* | `#C97B84` | secondary accent, selected states, collage/reel chrome |
| `--rose-soft` | `#EAD1CE` | soft fills, tint backgrounds |
| `--henna` | `#8A8A6A` | tertiary / success-ish accent |
| `--foreground` / ink | `#3A1620` | body text |
| `--muted-foreground` | `#98727A` | secondary text |
| `--border` / `--input` | `#ECD9D4` | borders, dividers |
| `--ring` | `#C97B84` | focus ring |

Derived shadcn neutrals (`--secondary`, `--accent`, `--popover`, `--destructive`, charts, sidebar) are regenerated from the above, preserving the current token structure. All foreground/background pairs must meet **WCAG AA 4.5:1** (verify `--marigold-deep` + white on buttons; darken to `#9E4A58` if it fails).

**Dark mode:** the app does not currently expose a dark toggle, so light is the shipped experience. For coherence we update the existing `.dark` block to the **Rose Gold & Wine · Dark** variant (deep wine `#241019` bg, cards `#331722`, pale gold-rose hairline borders `rgba(232,206,178,.26)`, rosy-cream text `#F4DEDA`) so any future dark toggle is on-brand. Not a shipping requirement.

`viewport.themeColor` in `layout.tsx` → `#FAF3EE`.

### 2.2 Typography

- **Display:** Fraunces (kept). Used for the wordmark and headings.
- **Body:** Hanken Grotesk (kept).
- **Remove:** Tiro Devanagari Hindi import (no Devanagari anymore). Drop `--font-devanagari` and all usages.

### 2.3 Wordmark — `Brand.tsx`

- Primary lockup: **`JEENA`** — Fraunces, weight 600, `text-transform: uppercase`, `letter-spacing: 0.18em`, colour `--maroon`.
- Large/hero placements add a subline: **"Est. 2026 · Forever"** — small caps, `letter-spacing: 0.3em`, colour `--marigold-deep`.
- Small/header placements render just `JEENA`.
- Remove `withDevanagari` prop and the `शादी` mark. Keep `size` variants (`sm | md | lg`) and the optional `href`.

### 2.4 Signature elements

- `Garland` (genda-phool toran) kept; colours already token-driven → inherits new palette automatically.
- New optional **sticker motifs** for the collage (garland, phera/fire, doli) as small inline SVGs.

---

## 3. Feature specs

### A. Rebrand (identity)

**Files:** `Brand.tsx`, `layout.tsx`, `page.tsx`, `results/page.tsx`, `upload/page.tsx`, `MagazineIntro.tsx`, `admin/page.tsx`, `globals.css`.

- `layout.tsx` metadata → title **"Our Wedding · Jeena"**, description rewritten for the couple; `themeColor` updated; Tiro font import removed.
- All visible "Shaadi" wordmarks → Jeena. The word "shaadi" may still appear as warm body copy (e.g. hashtags), but not as the logo.
- Hero (`page.tsx`): eyebrow chip "Nameeta weds Jeenendra" kept; wordmark + tagline "two hearts, one beginning"; body copy retained/tuned.
- Footer + intro copy updated; remove Devanagari kicker.

### B. Palette rollout

- Update `globals.css` `:root` (and `.dark`) tokens per §2.1, add `--rose` / `--color-rose`.
- Audit components for hard-coded colour literals that assume the old palette; most already reference tokens (`text-maroon`, `bg-marigold-deep`, etc.) and inherit for free.

### C. Selfie capture tray

**File:** `SelfieCapture.tsx` (extend).

Today the box only starts the live camera. New behaviour:

- The **entire selfie box becomes a button** (`role="button"`, keyboard-activatable) that opens an **action sheet / tray**:
  - **Take a selfie** → existing `startCamera()` live-capture flow.
  - **Choose from gallery** → file picker (existing `onFile` flow; input without `capture` so the OS shows the gallery).
- Mobile: bottom-sheet style tray (slide-up, scrim, swipe/tap-to-dismiss, Escape). Desktop: anchored popover.
- Keep the existing capture/upload buttons as a secondary affordance for the live/captured states; the tray is the entry point from idle.
- Accessibility: 44px targets, focus trap in the sheet, `aria-modal`, labelled options. Reuse existing capture/crop/mirror logic unchanged.

### D. Upload section

**Files:** `page.tsx` (home link), `upload/page.tsx`, `UploadDropzone.tsx`, `QuotaBar.tsx`.

- Home "contribute" link copy → **"Add your photos to the story."** with sub-line "Contribute the amazing shots you took — they get face-matched into everyone's gallery too."
- `/upload` page: refreshed palette, clearer quota storytelling (QuotaBar polish), tightened drag/empty/error states, warmer heading.
- No change to the presigned-PUT upload mechanics or quotas.

### E. Cinematic intro

**File:** `MagazineIntro.tsx` (rework), built on **framer-motion** (already a dependency).

- **Loading beat:** on first paint, the gold garland "thread" draws in (SVG `pathLength` animation) and the wordmark fades/scales in before the first panel content.
- **Orchestrated reveal:** staggered spring entrance per element (eyebrow → garland → title → tagline → body), `ease [0.22,1,0.36,1]`, exit faster than enter.
- **Ambient particles:** drifting marigold **petals + soft hearts** behind the gold frame (DOM/absolute elements or a lightweight canvas; capped count).
- Keep the 3-panel swipeable structure, dot-nav, Skip, keyboard nav, and `INTRO_SEEN_KEY` localStorage dismissal. Remove the Devanagari kicker.
- **Reduced motion:** all particle motion and slide transitions disabled under `prefers-reduced-motion`; content still reveals via opacity.
- Add light **scroll-reveal** to home sections below the fold (intersection-based fade/rise), reduced-motion respected.

### F. Collage 2.0

**Files:** `CollageMaker.tsx`, `src/lib/collage.ts` (extend).

1. **Aspect ratios:** `CANVAS` becomes ratio-aware — **4:5 (1080×1350, default)**, **1:1 (1080×1080)**, **9:16 (1080×1920)**. A ratio toggle in the editor; export dimensions follow the ratio; layouts adapt.
2. **Adjustable images (per-slot pan & zoom):** each slot stores a transform `{ scale, offsetX, offsetY }`. Interactions: drag to pan, wheel/pinch to zoom (touch + mouse). The transform is applied to the slot `<img>` (via `object-position` + `scale`/translate) and baked into the `html-to-image` export. Default = center-cover (current behaviour).
3. **More layouts:** extend `LAYOUTS` with ratio-aware definitions — asymmetric "magazine" grids, hero + N, 2/3/4/6-up editorial grids, story-format filmstrip (9:16), and a heart-shape mosaic. Existing polaroid/grid/filmstrip retained.
4. **More customization:** caption font-style options; optional sticker motifs (garland / phera / doli); border & radius sliders (existing); themes updated to the new palette (`THEMES` in `collage.ts`).
5. Export path unchanged (`html-to-image` → PNG, `pixelRatio 2`, `crossOrigin="anonymous"` on preview images). Share / Save / Add-to-gallery flows retained.

### G. Reel maker (new subsystem)

Photo selection → a **20–60s** MP4 slideshow with a trimmed **bundled song**, rendered **server-side**.

**Client UI** — new `ReelMaker.tsx` (full-screen editor, opened from Results like the collage maker):
- Reorderable photo strip (drag to reorder, add/remove).
- **Length** slider (default **20s**, max **60s**); per-photo duration derived (even split) with optional manual nudge.
- **Transition** style: crossfade / **Ken Burns** (slow pan-zoom) / cut.
- **Aspect:** 4:5 (default) or 9:16 (story).
- **Song picker:** list of bundled songs with a **waveform trim** control (choose a start point; clip auto-fit to reel length). Preview playback of the chosen clip.
- Render progress UI; on completion: **Save / Share / Add to album**.

**Data model** — `src/lib/reel.ts`:
- `SongCatalog` (id, title, artist, src, duration) — songs bundled in `public/audio/` (or an R2 `/audio/` path); files supplied by the host.
- `ReelSpec` = `{ photoIds[], aspect, totalSeconds, transition, perPhoto?[], song: { id, startSec } }`.

**Render pipeline** (server-side, ffmpeg):
1. `POST /api/reel` (Next.js route) — validates the `ReelSpec` (zod), authorizes, resolves photo **preview** URLs from the DB/R2, and forwards to the render service. Because heavy ffmpeg render is a poor fit for Vercel Hobby limits, the render runs on a **server with ffmpeg** — recommended: extend the existing **EC2 embed-service** (or a sibling container on the same box; 3.8 GB RAM, ffmpeg trivially available) with a `/reel` endpoint, authorized by a bearer token exactly like `EMBED_FN_URL` / `EMBED_API_KEY`. Final host to be confirmed in the plan.
2. Render service: pulls the compressed preview frames (re-encoding to uniform JPEG if needed), composes the slideshow with the selected transition, muxes the trimmed audio (`ffmpeg -ss <startSec> -t <totalSeconds>`), outputs **H.264 MP4** at 1080×1350 or 1080×1920.
3. Uploads the MP4 to R2 (private originals bucket or a `/reels/` prefix); returns a signed URL.
4. **Async job model** (render can take several seconds): `POST /api/reel` returns `{ jobId }`; client polls `GET /api/reel?jobId=…` until `{ status: "done", url }`. Job state stored in Postgres (new `reel_jobs` table) or in the render service; DB is preferred for reliability.
5. Rendered reels may optionally be added to the shared gallery (reuse the existing upload-complete + face-index path for the still frames? — reels are video; treat like guest video uploads, logged and admin-visible).

**New/changed surfaces:** `ReelMaker.tsx`, `src/lib/reel.ts`, `src/app/api/reel/route.ts` (create + status), render-service endpoint, `public/audio/*` (or R2), DB migration `reel_jobs`, results-page entry button, admin visibility of rendered reels.

### H. Favicon / app icon — "the couple"

A **cute illustrated couple** as the site favicon and app icon: two stylised faces side by side — a bride (bindi, dupatta/side-part, subtle jewellery) and a groom (turban/sehra or neat side-part) — rendered in the Rose Gold & Wine palette (wine ink, rose blush, gold accents on the ivory/card background). Warm, minimal, recognisable at 16px.

- Authored as a single **SVG** (`src/app/icon.svg`) so it stays crisp; Next.js App Router serves it as the icon automatically.
- Provide a maskable/rounded PNG set (`apple-icon.png` 180×180, and 32/16 via the SVG) and replace the current `src/app/favicon.ico`.
- Two size treatments: a detailed version for ≥32px, and a simplified two-dot-faces mark that still reads at 16px.
- Illustrated (not photographic) — no real selfies needed. If the host later wants likeness tweaks (glasses, hair), it's a quick SVG edit.

**New/changed surfaces:** `src/app/icon.svg`, `src/app/apple-icon.png`, `src/app/favicon.ico`, `layout.tsx` icon metadata (App Router auto-detects file-based icons).

---

## 4. Architecture summary

```
Home / Results / Upload (Next.js, Vercel)
  ├─ Brand (JEENA) · Rose Gold & Wine tokens · framer-motion intro
  ├─ SelfieCapture (tap → tray: camera | gallery)
  ├─ CollageMaker 2.0 (ratio-aware, per-slot pan/zoom, layouts)  ──► html-to-image (client)
  └─ ReelMaker (new)  ──► POST /api/reel ──► Render service (ffmpeg on EC2) ──► R2 (mp4)
                                   ▲                                   │
                                   └───────── poll GET /api/reel ◄─────┘
Neon Postgres: + reel_jobs (job state)      Cloudflare R2: previews (frames) + /reels (mp4)
```

New files (indicative):
- `src/components/ReelMaker.tsx`
- `src/lib/reel.ts`
- `src/app/api/reel/route.ts`
- `src/db/migrations/0004_reel_jobs.sql`
- render-service `/reel` handler (embed-service or sibling)
- `public/audio/` song assets (host-supplied)

Changed files (indicative): `Brand.tsx`, `layout.tsx`, `globals.css`, `page.tsx`, `results/page.tsx`, `upload/page.tsx`, `MagazineIntro.tsx`, `SelfieCapture.tsx`, `UploadDropzone.tsx`, `QuotaBar.tsx`, `CollageMaker.tsx`, `src/lib/collage.ts`, `src/lib/api.ts`, `src/lib/types.ts`, `admin/page.tsx`.

---

## 5. Testing

- **Unit (vitest):** palette token presence; collage ratio + per-slot transform math; reel `ReelSpec` validation + duration split; `/api/reel` route (msw) create/status branches.
- **Component (testing-library):** selfie tray open/select/dismiss + keyboard; collage ratio switch + pan/zoom transform applied; reel editor state.
- **E2E (Playwright):** rebrand smoke (title, wordmark), intro dismissal, selfie tray → gallery upload, collage export, reel create→poll→result (render service mocked).
- **Manual:** live camera capture on device; real ffmpeg render with a bundled song; reduced-motion pass; AA contrast check on the new palette.

---

## 6. Risks & resolved decisions

1. **Reel render host — RESOLVED:** add a `/reel` endpoint to the **EC2 embed-service** (ffmpeg readily available; 3.8 GB RAM), authorized with a bearer token like `EMBED_FN_URL`/`EMBED_API_KEY`. Fall back to a Vercel function only if the EC2 route proves unworkable.
2. **Song assets — RESOLVED (deferred):** ship a **placeholder song catalog** (a couple of royalty-free/silent clips) so the picker + trim UI are fully buildable and testable now; the host supplies the real files later — a drop-in replacement in `public/audio/` + the catalog list, no code change.
3. **Reel job persistence — RESOLVED:** use a Postgres **`reel_jobs`** table (migration `0004`).
4. **Render time / cost** — bound reel length (≤60s) and frame count; use compressed previews as frames.
5. **Collage per-slot gestures** — pinch-zoom on iOS Safari inside a modal; ensure no scroll/gesture conflict.
6. **`--marigold-deep` button contrast** — verify AA with white text; darken toward `#9E4A58` if needed.
7. **App dark mode** — updated `.dark` tokens included for coherence but not a shipping toggle unless requested.
8. **Favicon likeness** — illustrated couple, not photographic; likeness tweaks are quick SVG edits if the host wants them.

---

## 7. Rollout

Single feature branch. Suggested internal sequence (still one spec): palette + rebrand + intro (foundation) → selfie tray + upload copy → collage 2.0 → reel maker (largest, depends on render service + song assets). Each lands with its tests before the next. Ship behind the existing admin kill-switch where guest-facing.
