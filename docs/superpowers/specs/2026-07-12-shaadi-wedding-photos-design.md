# Shaadi — Wedding Photo Sharing with Face Search — Design Spec

**Date:** 2026-07-12
**Status:** Draft for review

## 1. Overview

A mobile-first website where wedding guests enter their name and a selfie (upload or live capture), and the site uses face recognition to find and return every photo they appear in. Guests can view compressed previews, download full-quality originals, and one-click "download all my photos" as a ZIP. Guests may also contribute their own photos/videos of the event (limited), which are auto-published, logged, and face-indexed. Everything is logged for audit.

### Goals
- Guest types name + selfie → sees **their** photos, fast, on mobile.
- **View = compressed preview** (low bandwidth/latency); **Download = full-quality original**; **Download all = ZIP of originals**.
- Guest uploads: ~**20 photos / 5 videos** each, auto-published + logged, photos face-indexed.
- Full audit log of who searched/uploaded/downloaded.
- Cheap (~$0.50–7/month), good open-source accuracy, biometric data on our own infra.

### Non-goals (YAGNI for v1)
- Face-search **inside videos** (frame extraction). Videos are store + play + poster only.
- Accounts/passwords for guests (access is open link).
- Video transcoding (store original + poster; rely on browser playback). Optional later.
- Pre-clustering all faces into named "people" galleries. Matching is on-demand KNN.
- Native mobile apps.

## 2. Users & Flows

### 2.1 Guest — "Find my photos" (primary)
1. Lands on home → enters **name**, then **takes a live selfie** (camera) or **uploads** one.
2. Server computes the selfie's face embedding, runs a vector KNN search against all indexed faces, returns distinct photos above the match threshold.
3. Guest sees a **mobile grid of compressed previews** of their photos. Tap → larger preview (lightbox). Per-photo **Download original**. Top-level **Download all (ZIP)**.
4. The search (name, timestamp, IP, user-agent, selfie, #matches) is logged.

**Edge cases:** no face detected in selfie → friendly retry prompt; multiple faces in selfie → use the largest/most-central face; zero matches → "no photos found yet, check back after more are uploaded."

### 2.2 Guest — "Upload photos" (contribution)
1. From their session (name known), open **Upload**. Select up to **20 photos** and **5 videos** (remaining quota shown).
2. Client requests presigned upload URLs; **server enforces limits** (per session + per IP) before issuing them.
3. Files upload directly to R2 (originals, private). A processing step generates previews (and video posters), **face-indexes photos**, inserts rows, **auto-publishes**, logs everything.
4. Contributed photos become part of face-search for everyone.

**Validation:** file type allowlist (jpeg/png/heic/webp for photos; mp4/mov for video), max size per file (e.g. photo ≤ 25 MB, video ≤ 300 MB), quota enforced server-side (never trust client).

### 2.3 Admin (you)
- Password-protected `/admin`.
- View audit logs (searches, uploads, downloads) with filters.
- Browse all photos/uploads; **delete** any photo/upload (removes from R2 + DB + index).
- **Kill-switch** to take the site offline instantly.
- Tune **match threshold**; optionally flip a **shared passcode** gate on (one setting) if open access is abused.

## 3. Architecture

Approach A, unified on Vercel:

```
[Guest browser / mobile]
     │  name + selfie (live/upload)
     ▼
[Next.js app on Vercel] ──────────────► [Neon Postgres + pgvector]  (embeddings, logs, metadata)
     │  selfie image                          ▲
     ▼                                        │ KNN cosine search
[Vercel Python function: InsightFace] ────────┘  (selfie → 512-d embedding)
     │
     ├── serve previews ◄──── [Cloudflare R2: shaadi-previews (public, cached)]
     └── signed download / upload ◄──► [Cloudflare R2: shaadi-photos (private originals)]

[One-time local ingest on Mac] ── pendrive → InsightFace + sharp/Pillow → R2 + Neon
```

- **Frontend + API:** Next.js (App Router) on Vercel. Mobile-first.
- **Face embedding (runtime):** Vercel **Python function** running InsightFace `buffalo_l` (onnxruntime). Computes one 512-d embedding per selfie / per uploaded photo face.
- **Vector search:** Neon Postgres + **pgvector** (HNSW, `vector_cosine_ops`).
- **Storage:** Cloudflare R2 — `shaadi-photos` (private originals), `shaadi-previews` (public compressed).
- **Ingest (one-time):** local Python script on the Mac (from pendrive), reusing the same InsightFace model + `sharp`/Pillow for previews.

### Components (isolated units)
- `ingest/` — local batch: walk pendrive → detect+embed faces → make previews → upload R2 → insert DB. Idempotent (skip already-processed by content hash).
- `face-service` (Vercel Python fn) — `POST /embed` (image → embedding[]). Stateless.
- `web` (Next.js) — routes/UI + API routes for search, upload-url, download-url, zip, admin.
- `db` — schema + queries (pgvector KNN, logging).
- `previews` — shared preview-generation logic (sharp on Vercel for uploads; Pillow/sharp locally for ingest).

## 4. Data Model (Postgres)

```
photos
  id              uuid pk
  source          text        -- 'ingest' | 'guest_upload'
  content_hash    text unique -- dedupe
  original_key    text        -- R2 key in shaadi-photos
  preview_key     text        -- R2 key in shaadi-previews (medium)
  thumb_key       text        -- R2 key in shaadi-previews (grid)
  width, height   int
  bytes           bigint
  taken_at        timestamptz null
  uploaded_by     text null   -- guest name if source=guest_upload
  upload_session  uuid null
  status          text        -- 'active' | 'deleted'
  created_at      timestamptz

faces
  id              uuid pk
  photo_id        uuid fk -> photos.id
  embedding       vector(512)   -- L2-normalized ArcFace
  bbox            jsonb         -- x,y,w,h
  det_score       real
  created_at      timestamptz
  -- HNSW index on embedding (vector_cosine_ops)

media (videos)
  id, source, content_hash, original_key, poster_key, duration, bytes,
  uploaded_by, upload_session, status, created_at

search_sessions
  id              uuid pk
  guest_name      text
  ip, user_agent  text
  selfie_key      text        -- private R2 (audit)
  match_count     int
  created_at      timestamptz

upload_events
  id, upload_session, guest_name, ip, user_agent,
  photo_count, video_count, created_at

download_events
  id, session_id null, guest_name, ip, kind ('single'|'zip'),
  photo_id null, count, created_at

admin_settings   -- single row: match_threshold, passcode_enabled, passcode_hash, kill_switch
```

All access tables retain IP + UA + timestamp for audit.

## 5. Face Recognition Pipeline

### 5.1 Ingest (one-time, local)
For each photo on the pendrive:
1. Compute content hash; skip if already in `photos`.
2. Detect faces (SCRFD) + embed each (ArcFace, 512-d, L2-normalized), `allowed_modules=['detection','recognition']`.
3. Generate **thumb** (~350px WebP, q78, <30KB) and **medium preview** (~1280px, WebP q80 + AVIF).
4. Upload original → `shaadi-photos/originals/…`; previews → `shaadi-previews/…`.
5. Insert `photos` row + one `faces` row per detected face.

Runs overnight on Apple Silicon (onnxruntime-silicon / CoreML). Resumable & idempotent.

### 5.2 Runtime match
1. Selfie → `face-service` → largest-face 512-d embedding.
2. `SELECT photo_id, 1 - (embedding <=> $1) AS similarity FROM faces WHERE ... ORDER BY embedding <=> $1 LIMIT N` (HNSW).
3. Keep faces with **similarity ≥ threshold** (default ~0.38, tunable in admin); collapse to **distinct active photos**; order by best similarity.
4. Return preview/thumb URLs + photo ids. Log `search_sessions`.

**Threshold:** starts at a sensible ArcFace default and is tuned against real photos during testing; exposed in admin. Bias slightly toward recall (show a few extra) since guests can visually confirm.

## 6. Storage Layout & Previews (R2)

```
shaadi-photos (private)
  originals/<photo_id>.<ext>
  uploads/<session>/<photo_id>.<ext>
  videos/<media_id>.<ext>
  selfies/<session>.jpg            -- audit, private

shaadi-previews (public, immutable-cached)
  thumb/<photo_id>.webp            -- grid, ~350px, <30KB
  medium/<photo_id>.webp           -- lightbox, ~1280px
  medium/<photo_id>.avif           -- lightbox, AVIF preferred
  poster/<media_id>.webp           -- video poster
```

- Previews served from `pub-…r2.dev` (custom domain before launch), `Cache-Control: public, max-age=31536000, immutable`.
- `<picture>`: AVIF → WebP fallback for medium; `srcset`/`sizes` responsive; mobile never fetches desktop sizes.
- Libraries: `sharp` (Vercel uploads), Pillow/sharp (local ingest); ffmpeg for posters.

## 7. Download

- **Single original:** API issues a short-lived **presigned GET** to `shaadi-photos`; browser downloads full quality. Logged.
- **Download all (ZIP):** API streams a ZIP of the guest's matched originals — server fetches each original from R2 (zero egress) and streams into the response (`archiver`/zip stream), so memory stays flat and it survives large sets. For very large sets (e.g. >~1.5 GB or >N files), fall back to preparing the ZIP and returning a ready link (or chunked ZIPs). Logged as `zip`.

## 8. Upload Limits & Validation

- Quota: **20 photos + 5 videos per guest session** (keyed by session + IP), enforced **server-side** at presign time.
- Type allowlist (jpeg/png/heic/webp; mp4/mov). Size caps (photo ≤ 25 MB, video ≤ 300 MB).
- HEIC → converted to JPEG/WebP for preview (original kept as-is).
- Processing after upload: previews + poster, face-index photos, insert rows, auto-publish, log.

## 9. Privacy, Security, Audit

- **Open access** by design, but guarded: **rate-limit** selfie searches per IP (e.g. ~30/hour) to deter scraping; hidden **admin kill-switch**; optional **shared passcode** toggle (one setting) if abused.
- **Biometric data** (embeddings, selfies) stays in our Neon/R2 — never sent to a third-party face API.
- Selfies stored privately for audit; documented retention (e.g. auto-purge selfies after N days — configurable).
- Full audit: search/upload/download events with IP, UA, timestamp.
- Secrets in gitignored `.env` (Neon URL, R2 keys); CORS locked to real domain before launch; admin behind password.

## 10. UI / UX (mobile-first)

Design via `frontend-design` + `ui-ux-pro-max` skills. Direction: warm, celebratory wedding aesthetic, elegant but fast; large tap targets; skeleton loaders; optimistic previews.
- **Home:** name field + big "Take selfie / Upload" — single clear action.
- **Camera:** in-browser `getUserMedia` live capture with front camera + upload fallback.
- **Results:** responsive masonry/grid of thumbs; sticky "Download all"; tap → lightbox (swipe, download).
- **Upload:** drag/drop or picker with live quota, progress bars, per-file status.
- **Admin:** simple protected dashboard — logs table, media browser + delete, settings (threshold, passcode, kill-switch).

## 11. Cost

R2 ~$0.50/mo (45 GB, $0 egress) · Neon free tier · Vercel Hobby (or Pro if needed) · ingest is local (free). **~$0.50–7/month.** Watch: cold starts on Vercel Python fn + Neon scale-to-zero → pre-warm around the event.

## 12. Open Questions / To Confirm During Build
- Custom domain for previews + app (do you own a domain?).
- Exact match threshold (tuned on real photos).
- Selfie retention period.
- Whether iPhone `.mov`/HEVC videos need transcoding for broad playback (defer unless it breaks).

## 13. Build Order (high level)
1. Repo scaffold (Next.js + Python fn) + `.env` + DB schema/migrations.
2. `face-service` embed function + local ingest script (validate on a sample folder from pendrive).
3. Search flow (selfie → match → results grid) end-to-end.
4. Download (single + ZIP).
5. Upload flow + limits + processing.
6. Admin + logging + rate-limit + kill-switch.
7. UI polish (frontend-design / ui-ux-pro-max), pre-warm, lock CORS/domain, full pendrive ingest.
