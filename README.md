# Shaadi — Wedding Photo Sharing with Face Search

A mobile-first web app for sharing wedding photos. Guests enter a name and a
selfie (upload or live capture), and face recognition returns every photo they
appear in — view compressed previews, download full-quality originals, or grab
them all as a ZIP. Guests can also contribute their own photos/videos (with
limits), and everything is logged for a simple admin dashboard.

## Architecture

```
Browser ──► Next.js app (Vercel) ──► Neon Postgres + pgvector   (embeddings, logs, metadata)
              │                    └─► Cloudflare R2             (private originals, public previews)
              └─► EMBED_FN_URL ──► Face-embedding service        (InsightFace buffalo_l, 512-d)
Local one-time ingest (ingest/) indexes a folder of photos into R2 + Postgres.
```

- **Web + API:** Next.js 15 (App Router, TypeScript), Tailwind + shadcn/ui.
- **Face recognition:** InsightFace `buffalo_l` (SCRFD detector + ArcFace, 512-d
  L2-normalized embeddings); cosine KNN via pgvector HNSW.
- **Storage:** Cloudflare R2 — private originals, public compressed previews
  (WebP thumbnails + AVIF/WebP medium).
- **DB:** Postgres (Neon) with the `pgvector` extension.
- **Embedding service:** the model's dependencies (~550 MB) exceed a typical
  serverless function limit, so embedding runs as a small container
  (`embed-service/`) — deploy it on any host with ≥2 GB RAM and point
  `EMBED_FN_URL` at it.

## Layout

| Path | What |
|---|---|
| `src/app` | pages + API routes (search, download, upload, admin) |
| `src/lib` | db, r2, previews, embed client, auth, rate limiting, env |
| `api/embed` | shared InsightFace logic (`face.py`) |
| `embed-service/` | Dockerized embedding service + deploy guide |
| `ingest/` | one-time local indexer (folder → R2 + Postgres) |
| `tests/` | Vitest (unit/integration) + Playwright (e2e) |

## Setup

1. `pnpm install`
2. Copy `.env.example` → `.env` and fill in `DATABASE_URL`, R2 keys, `ADMIN_PASSWORD`, `SESSION_SECRET`, `EMBED_FN_URL`.
3. Run migrations: `pnpm tsx src/db/migrate.ts`
4. Dev: `pnpm dev` · Build: `pnpm build` · Tests: `pnpm test` / `pnpm exec playwright test`
5. Index photos: see `ingest/README.md`. Deploy the embedding service: see `embed-service/README.md`.

## Features

- Face-search: name + selfie → your photos (open access, per-IP rate limited).
- Compressed previews for viewing; full-quality originals on download; ZIP "download all".
- Guest uploads with per-IP quotas (photos/videos), auto face-indexed.
- Admin: audit logs, media browser + delete, match-threshold, optional guest
  passcode, and a maintenance kill-switch.
- Selfies are embedded in memory and never persisted.
