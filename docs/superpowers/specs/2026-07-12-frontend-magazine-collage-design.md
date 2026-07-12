# Shaadi Frontend Enhancements — Design Spec

**Date:** 2026-07-12 · **Branch:** `feat/frontend-magazine` · **Status:** approved, build locally first

Mobile-first enhancements to the live Shaadi wedding photo site. Build on the existing theme (maroon/marigold/gold, `font-heading`) and components (SelfieCapture, PhotoGrid, Lightbox, UploadDropzone, AdminTable). Run locally against the real backend (`NEXT_PUBLIC_API_MOCKING=disabled`) before shipping.

## 1. Magazine intro flow (`src/components/MagazineIntro.tsx`, shown on Home)
- 2–3 full-screen, swipeable panels using **framer-motion**; shown once (localStorage `shaadi_intro_seen_v1`), **Skip** always available, dot-nav.
- Panel 1 (cover): "Nameeta ki Shaadi", editorial title + date + garland motif + subtle animation; copy ~ "We've kept your moments safe — let me share them with you."
- Panel 2 (optional middle): couple hashtag / warm line, decorative transition.
- Panel 3 (CTA): "See your photos" → dismiss → reveals existing name + selfie search form (unchanged logic).
- Advance via swipe/tap/dot; respects `prefers-reduced-motion`. No layout shift; full 100dvh panels, safe-area insets.

## 2. Collage maker (`src/components/CollageMaker.tsx` + entry on Results)
- Results page: "Make a collage" → selection mode over PhotoGrid (tap to select up to layout capacity) → editor.
- Editor controls: **layout** (2/3/4/6/9-photo grids, mosaic/magazine, polaroid stack, filmstrip), **style** (theme color, border width, corner radius, background motif/plain), **caption/hashtag** text.
- **Presets** (bundle caption + starter layout + theme; fully editable after applying): `#MyFamily`, `#OurWedding`, `#BehenKiWedding`, `#CousinKiShaadi`, `#BhaiBehen`, `#Cousins`, `#ShubhVivah`, `#SaatPhere`, `#JaiJinendra`.
- Render the styled DOM collage to a **high-res PNG** via `html-to-image` (uses medium preview images already loaded; CORS-safe from R2 public bucket).
- Output — all three: **Download PNG**, **native Share** (`navigator.share` with the File; fallback to download), **Add to gallery** (upload the PNG through the existing contribution pipeline as a `guest_upload` photo; collages are NOT face-indexed — insert photo row + previews only).

## 3. Upload discoverability
- Keep the selfie's upload fallback (search). Add clear entries to the **contribution** page `/upload` ("Add your photos & videos to everyone's collection"): a secondary link on Home and a prominent CTA on Results. Relabel copy so it's obviously "add your phone photos to the shared album."

## 4. Silent search logging (admin-only)
- **Remove** the "Your selfie … then discarded" line from Home (no false promise; no replacement notice).
- Search route (`src/app/api/search/route.ts`): store the selfie privately to R2 `selfies/<sessionId>.jpg` (was intentionally skipped as B3) and pass `selfie_key` to `logSearch` (column already exists). Name/ip/ua/time/match_count already logged.
- Admin: add a **"Who searched"** view — new `GET /api/admin/searches` (auth) returning `{ id, guestName, at, matchCount, selfieUrl }` where `selfieUrl` is a short-lived signed GET to the private selfie; render name + selfie thumbnail + time + #matches in the admin dashboard. Add `db.listSearches({limit,offset})`.
- Guest-facing UI never mentions collection.

## Tech
- Add deps: `framer-motion`, `html-to-image`.
- New: `MagazineIntro.tsx`, `CollageMaker.tsx`, collage layout/preset config, `GET /api/admin/searches`, `db.listSearches`. Modify: Home, Results, search route, admin page, `logSearch` call, SelfieCapture copy.
- Tests: e2e for intro (shown once, skip, reveal search), collage (select → render → download intercepted), admin searches (auth + shape); keep vitest/playwright green.

## Non-goals
- No face-indexing of collages. No change to the ingest/embed pipeline. No new backend infra.
