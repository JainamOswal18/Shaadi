# Shaadi Wedding Photo-Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Frontend tasks additionally REQUIRE invoking `frontend-design` and `ui-ux-pro-max` skills before writing UI code.

**Goal:** A mobile-first website where wedding guests enter a name + selfie, get face-matched to every photo they appear in (compressed previews to view, full-quality originals to download, ZIP "download all"), and can contribute their own photos/videos with limits — all logged.

**Architecture:** Next.js (App Router) app on Vercel handles UI + API. A Vercel Python function runs InsightFace `buffalo_l` to turn one selfie/face into a 512-d embedding. Neon Postgres + pgvector stores embeddings + metadata + audit logs and does cosine KNN. Cloudflare R2 stores private originals (`shaadi-photos`) and public compressed previews (`shaadi-previews`). A one-time local Python script indexes the pendrive.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS + shadcn/ui, `postgres` (postgres.js) + raw SQL migrations, pgvector (HNSW), `@aws-sdk/client-s3` + `s3-request-presigner`, `sharp`, `archiver`, `zod`, `jose` (admin cookie), InsightFace + onnxruntime (Python), Vitest + Playwright + pytest. Package manager: **pnpm**. Node 24.

## Global Constraints

- **Node:** 24 LTS. **pnpm** for all JS deps. **Python:** 3.13 (local ingest via `onnxruntime-silicon`; Vercel fn via `onnxruntime`).
- **Secrets:** only from `.env` (gitignored). Never hardcode. Keys already present: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_ORIGINALS=shaadi-photos`, `R2_BUCKET_PREVIEWS=shaadi-previews`, `R2_PREVIEWS_PUBLIC_URL=https://YOUR_R2_PUBLIC_BUCKET.r2.dev`, `ADMIN_PASSWORD`.
- **Embeddings:** InsightFace ArcFace `buffalo_l`, **512-dim, L2-normalized**. Stored as `vector(512)`. Cosine operator `<=>`. Similarity = `1 - distance`.
- **Default match threshold:** `0.38` similarity (tunable via `admin_settings`). Bias to recall.
- **Upload limits:** 20 photos + 5 videos per guest session (server-enforced). Photo ≤ 25 MB, video ≤ 300 MB. Photo types: jpeg/png/heic/webp. Video: mp4/mov.
- **Preview sizes:** thumb ~350px WebP q78 (<30 KB); medium ~1280px WebP q80 + AVIF. Cache-Control `public, max-age=31536000, immutable`.
- **Ingest source:** `/path/to/your/photos` (recurse `1st/`, `29th/`, `30th/`), `*.jpg` only, skip RAW/system. ~3,216 files, ~46 GB. Idempotent by content hash.
- **Mobile-first, scalable:** all UI responsive from 320px up; large tap targets; skeleton loaders; responsive `<picture>`/`srcset`; keyset pagination for large result sets.
- **Testing:** every task ends green. Unit (Vitest/pytest), integration (API routes against a test DB schema), e2e (Playwright). No task is "done" until its tests pass (evidence required).

## File Structure

```
/                              (repo root, git)
  .env / .env.example          (secrets — .env gitignored)
  package.json  pnpm-lock.yaml  tsconfig.json  next.config.ts  vercel.ts
  tailwind.config.ts  postcss.config.mjs  vitest.config.ts  playwright.config.ts
  src/
    app/
      layout.tsx  globals.css  page.tsx              (Home: name + selfie)
      results/page.tsx                               (results grid)
      upload/page.tsx                                (guest upload)
      admin/page.tsx  admin/login/page.tsx           (admin dashboard)
      api/
        search/route.ts        (POST selfie -> matches)
        embed/route.ts         (proxy to python fn OR co-located; see Task 5)
        download/route.ts      (GET single presigned original)
        download-zip/route.ts  (GET stream ZIP of a session's matches)
        upload-url/route.ts    (POST -> presigned PUTs, quota-enforced)
        upload-complete/route.ts (POST -> process uploaded files)
        admin/login/route.ts   admin/logs/route.ts  admin/settings/route.ts  admin/delete/route.ts
    components/                (UI: SelfieCapture, PhotoGrid, Lightbox, UploadDropzone, QuotaBar, AdminTable, ui/* shadcn)
    lib/
      db.ts                    (postgres client + typed queries)
      r2.ts                    (S3 client, presign, public url, stream, delete)
      previews.ts              (sharp: thumb/medium/avif; ffmpeg poster)
      embed-client.ts          (call the python embed fn)
      types.ts                 (Photo, Face, MatchResult, ...)
      auth.ts                  (admin cookie sign/verify)
      ratelimit.ts             (DB sliding-window per IP)
      env.ts                   (zod-validated env loader)
    db/
      migrations/0001_init.sql  migrations/0002_indexes.sql
      migrate.ts               (apply migrations)
  api/embed/                   (Vercel Python function)
    index.py  requirements.txt
  ingest/                      (local one-time indexer)
    main.py  requirements.txt  README.md
  tests/
    unit/*  integration/*  e2e/*
```

## Dependency Graph & Parallelization (for subagent fan-out)

```
PHASE 0 (sequential, 1 agent): T1 scaffold  ->  unblocks everything
PHASE 1 (parallel, after T1):   T2 db  |  T3 r2  |  T4 types+env  |  T5 embed-fn
PHASE 2 (parallel, after P1):   BACKEND lane        FRONTEND lane          INGEST lane
                                 T6 previews          T11 design system      T16 ingest
                                 T7 search API        T12 home+selfie
                                 T8 download+zip       T13 results+lightbox
                                 T9 upload API+proc    T14 upload UI
                                 T10 admin API         T15 admin UI
   (Frontend lane builds against the API contracts in T4/each backend task's
    "Produces" block, using MSW mocks; no shared files with backend lane.)
PHASE 3 (sequential, 1 agent):  T17 e2e wiring & tests  ->  T18 deploy/prewarm/CORS/full-ingest
```

**Fan-out rule for the orchestrator:** Phase 1 = up to 4 parallel agents. Phase 2 = up to 3 lane-agents (backend / frontend / ingest) running concurrently; within a lane tasks are sequential (shared `lib/` files). Two-stage review (per subagent-driven-development) between every task. Frontend and backend lanes touch disjoint directories (`components/`+`app/*/page.tsx` vs `app/api/*`+`lib/*`), so they don't conflict; the small overlap (`lib/types.ts`) is frozen after T4.

## Testing Strategy

- **Unit:** pure functions (previews sizing, quota math, threshold filter, auth sign/verify, env parse) with Vitest; Python embedding shape with pytest.
- **Integration:** API routes hit a **real Neon test schema** (`shaadi_test` search_path) seeded with fixture rows; R2 calls hit a **local mock** (`aws-sdk-client-mock`) except one live smoke test.
- **E2E (Playwright):** the four flows against `next dev` with a seeded DB and a stub embed endpoint returning deterministic vectors.
- **Evidence:** each task's final step runs the command and must show PASS. Never mark done on unrun tests.

---

### Task 1: Repo scaffold & tooling (PHASE 0)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `vitest.config.ts`, `playwright.config.ts`, `src/lib/env.ts`
- Modify: `.gitignore` (already present)

**Interfaces:**
- Produces: a running `pnpm dev` Next.js app; `pnpm test`, `pnpm test:e2e`, `pnpm build` scripts; `loadEnv()` in `src/lib/env.ts` returning a typed, validated config object.

- [ ] **Step 1: Init Next.js + Tailwind + shadcn**

```bash
pnpm dlx create-next-app@latest . --ts --tailwind --app --src-dir=false --import-alias "@/*" --use-pnpm --no-eslint --yes
# move app under src/: create-next-app puts app/ at root; relocate to src/app and set config below
```
If create-next-app scaffolds `app/` at root, move it: `mkdir -p web && git mv app src/app 2>/dev/null || mv app src/app`. Point `next.config.ts` and tsconfig `paths` at `src/`.

- [ ] **Step 2: Add dependencies**

```bash
pnpm add postgres @aws-sdk/client-s3 @aws-sdk/s3-request-presigner sharp archiver zod jose
pnpm add -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @playwright/test aws-sdk-client-mock msw @types/archiver
pnpm dlx shadcn@latest init --yes -b neutral
pnpm exec playwright install chromium
```

- [ ] **Step 3: Write `src/lib/env.ts` (zod-validated)**

```ts
import { z } from "zod";
const Schema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_ORIGINALS: z.string().default("shaadi-photos"),
  R2_BUCKET_PREVIEWS: z.string().default("shaadi-previews"),
  R2_PREVIEWS_PUBLIC_URL: z.string().url(),
  ADMIN_PASSWORD: z.string().min(1),
  EMBED_FN_URL: z.string().url().optional(),
});
export type Env = z.infer<typeof Schema>;
let cached: Env | null = null;
export function loadEnv(): Env {
  if (cached) return cached;
  cached = Schema.parse(process.env);
  return cached;
}
```

- [ ] **Step 4: Write a smoke test**

```ts
// tests/unit/env.test.ts
import { describe, it, expect } from "vitest";
import { loadEnv } from "@/lib/env";
describe("env", () => {
  it("parses required vars", () => {
    process.env.DATABASE_URL ??= "postgres://u:p@h/db";
    process.env.R2_ENDPOINT ??= "https://x.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID ??= "k"; process.env.R2_SECRET_ACCESS_KEY ??= "s";
    process.env.R2_PREVIEWS_PUBLIC_URL ??= "https://pub-x.r2.dev";
    process.env.ADMIN_PASSWORD ??= "pw";
    expect(loadEnv().R2_BUCKET_ORIGINALS).toBe("shaadi-photos");
  });
});
```

- [ ] **Step 5: Run & commit**

Run: `pnpm test tests/unit/env.test.ts` → Expected: PASS. `pnpm build` → Expected: succeeds.
```bash
git add -A && git commit -m "chore: scaffold Next.js app, tooling, env loader"
```

---

### Task 2: Database schema, migrations & typed queries (PHASE 1)

**Files:**
- Create: `src/db/migrations/0001_init.sql`, `src/db/migrations/0002_indexes.sql`, `src/db/migrate.ts`, `src/lib/db.ts`, `tests/integration/db.test.ts`

**Interfaces:**
- Consumes: `loadEnv()`.
- Produces:
  - `sql` — a `postgres` client.
  - `insertPhoto(p): Promise<{id}>`, `insertFaces(photoId, faces): Promise<void>`
  - `searchByEmbedding(embedding: number[], threshold: number, limit: number): Promise<MatchResult[]>` where `MatchResult = { photoId, similarity, thumbKey, previewKey }`
  - `logSearch(x): Promise<{id}>`, `getSessionQuota(sessionId): Promise<{photos:number, videos:number}>`, `insertMedia`, `getSettings(): Promise<AdminSettings>`, `updateSettings`, `logDownload`, `logUpload`, `softDeletePhoto(id)`, `listLogs(filter)`.

- [ ] **Step 1: Write migration `0001_init.sql`**

```sql
create extension if not exists vector;
create table photos (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ingest','guest_upload')),
  content_hash text unique not null,
  original_key text not null,
  preview_key text not null,
  thumb_key text not null,
  width int, height int, bytes bigint,
  taken_at timestamptz, uploaded_by text, upload_session uuid,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now()
);
create table faces (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  embedding vector(512) not null,
  bbox jsonb, det_score real,
  created_at timestamptz not null default now()
);
create table media (
  id uuid primary key default gen_random_uuid(),
  source text not null, content_hash text unique not null,
  original_key text not null, poster_key text,
  duration real, bytes bigint, uploaded_by text, upload_session uuid,
  status text not null default 'active', created_at timestamptz not null default now()
);
create table search_sessions (
  id uuid primary key default gen_random_uuid(),
  guest_name text, ip text, user_agent text, selfie_key text,
  match_count int, created_at timestamptz not null default now()
);
create table upload_events (
  id uuid primary key default gen_random_uuid(),
  upload_session uuid, guest_name text, ip text, user_agent text,
  photo_count int default 0, video_count int default 0, created_at timestamptz not null default now()
);
create table download_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid, guest_name text, ip text,
  kind text check (kind in ('single','zip')), photo_id uuid, count int,
  created_at timestamptz not null default now()
);
create table admin_settings (
  id int primary key default 1,
  match_threshold real not null default 0.38,
  passcode_enabled boolean not null default false,
  passcode_hash text,
  kill_switch boolean not null default false
);
insert into admin_settings (id) values (1) on conflict do nothing;
```

- [ ] **Step 2: Write `0002_indexes.sql`**

```sql
create index if not exists faces_embedding_hnsw
  on faces using hnsw (embedding vector_cosine_ops);
create index if not exists photos_status_created on photos(status, created_at desc);
create index if not exists search_sessions_ip_created on search_sessions(ip, created_at desc);
```

- [ ] **Step 3: Write `migrate.ts`** — reads `src/db/migrations/*.sql` sorted, runs each in a transaction, tracks applied in a `_migrations` table. (Full code: connect via `postgres(loadEnv().DATABASE_URL)`, `create table if not exists _migrations(name text primary key, applied_at timestamptz default now())`, skip already-applied.)

- [ ] **Step 4: Write `db.ts`** with `sql` client and the query functions from Interfaces. Key one:

```ts
export async function searchByEmbedding(embedding: number[], threshold: number, limit: number): Promise<MatchResult[]> {
  const vec = `[${embedding.join(",")}]`;
  const rows = await sql<MatchResult[]>`
    select p.id as "photoId", p.thumb_key as "thumbKey", p.preview_key as "previewKey",
           max(1 - (f.embedding <=> ${vec}::vector)) as similarity
    from faces f join photos p on p.id = f.photo_id
    where p.status = 'active'
    group by p.id, p.thumb_key, p.preview_key
    having max(1 - (f.embedding <=> ${vec}::vector)) >= ${threshold}
    order by similarity desc
    limit ${limit}`;
  return rows;
}
```

- [ ] **Step 5: Integration test** (`tests/integration/db.test.ts`): run migrations against a `shaadi_test` schema, insert a photo + 2 faces (one near a probe vector, one far), assert `searchByEmbedding(probe, 0.38, 10)` returns exactly the near photo. Run: `pnpm test tests/integration/db.test.ts` → PASS.

- [ ] **Step 6: Apply migrations to Neon & commit**

Run: `pnpm tsx src/db/migrate.ts` → Expected: "applied 0001_init, 0002_indexes". Commit.

---

### Task 3: R2 storage client (PHASE 1)

**Files:** Create `src/lib/r2.ts`, `tests/unit/r2.test.ts`

**Interfaces:**
- Consumes: `loadEnv()`.
- Produces: `presignPut(key, contentType, bucket?): Promise<string>`, `presignGet(key, opts?): Promise<string>`, `previewUrl(key): string`, `putObject(key, body, contentType, bucket?)`, `getObjectStream(key, bucket?): Promise<Readable>`, `deleteObject(key, bucket?)`.

- [ ] **Step 1: Test (mocked S3)** using `aws-sdk-client-mock`: assert `previewUrl("thumb/x.webp")` === `${R2_PREVIEWS_PUBLIC_URL}/thumb/x.webp`; assert `presignPut` returns a URL containing the key.
- [ ] **Step 2: Run test → FAIL.**
- [ ] **Step 3: Implement `r2.ts`** — one `S3Client` (`region:"auto"`, `endpoint`, creds from env, `forcePathStyle:true`), presigners with 15-min expiry, `previewUrl` = public base + key.
- [ ] **Step 4: Run test → PASS.**
- [ ] **Step 5: Live smoke** (guarded by `RUN_LIVE=1`): put a 1-byte object to `shaadi-previews`, fetch its public URL, assert 200; delete. Commit.

---

### Task 4: Shared types & API contracts (PHASE 1)

**Files:** Create `src/lib/types.ts`, `tests/unit/types.test.ts`

**Interfaces:**
- Produces (frozen after this task — both lanes import these):

```ts
export type EmbedFace = { embedding: number[]; bbox: [number,number,number,number]; det_score: number };
export type EmbedResponse = { faces: EmbedFace[] };
export type MatchResult = { photoId: string; similarity: number; thumbKey: string; previewKey: string };
export type SearchResponse = { sessionId: string; matches: (MatchResult & { thumbUrl: string; previewUrl: string })[] };
export type UploadUrlRequest = { sessionId: string; guestName: string; files: { name: string; type: string; size: number; kind: "photo"|"video" }[] };
export type UploadUrlResponse = { grants: { name: string; key: string; putUrl: string }[]; remaining: { photos: number; videos: number } };
export type AdminSettings = { match_threshold: number; passcode_enabled: boolean; kill_switch: boolean };
```

- [ ] **Step 1–3:** Write the types; a trivial type-level test (`expectTypeOf`) ensuring `SearchResponse.matches[0]` extends `MatchResult`. Run `pnpm test tests/unit/types.test.ts` → PASS. Commit. **After this commit, `types.ts` is frozen; changes require orchestrator sign-off.**

---

### Task 5: Face-embedding function (Python, Vercel) (PHASE 1)

**Files:** Create `api/embed/index.py`, `api/embed/requirements.txt`, `src/lib/embed-client.ts`, `tests/integration/embed.test.ts`

**Interfaces:**
- Produces: HTTP `POST /api/embed` — body: `multipart/form-data` with `image` (or JSON `{imageBase64}`). Returns `EmbedResponse` (all detected faces). `embed-client.ts` exposes `embedImage(bytes: Buffer): Promise<EmbedResponse>` and `largestFace(r: EmbedResponse): number[] | null`.

- [ ] **Step 1: Write `api/embed/index.py`**

```python
import base64, json, io
import numpy as np
from insightface.app import FaceAnalysis
from PIL import Image

_app = None
def get_app():
    global _app
    if _app is None:
        a = FaceAnalysis(name="buffalo_l", allowed_modules=["detection","recognition"])
        a.prepare(ctx_id=-1, det_size=(640,640))  # ctx_id=-1 -> CPU
        _app = a
    return _app

def handler(request):
    body = request.get_json() if request.headers.get("content-type","").startswith("application/json") else None
    img_bytes = base64.b64decode(body["imageBase64"]) if body else request.files["image"].read()
    img = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))[:, :, ::-1]  # RGB->BGR
    faces = get_app().get(img)
    out = [{
        "embedding": (f.normed_embedding).tolist(),
        "bbox": [float(x) for x in f.bbox.tolist()],
        "det_score": float(f.det_score),
    } for f in faces]
    return {"statusCode": 200, "body": json.dumps({"faces": out})}
```
`requirements.txt`: `insightface==0.7.3`, `onnxruntime`, `numpy`, `pillow`. (Vercel Large Functions: set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`; see Task 18.)

- [ ] **Step 2: Write `embed-client.ts`** — POST bytes to `EMBED_FN_URL ?? "/api/embed"`, parse `EmbedResponse`; `largestFace` = face with max bbox area, return its `embedding` or `null`.
- [ ] **Step 3: Test** (`embed.test.ts`, guarded `RUN_EMBED=1`): POST a known face image, assert `faces.length >= 1` and `embedding.length === 512` and vector is unit-norm (‖v‖≈1). A default (unguarded) test asserts `largestFace` picks the biggest bbox from a fixture `EmbedResponse`.
- [ ] **Step 4: Run tests → PASS.** Commit.

---

### Task 6: Preview generation (BACKEND lane, PHASE 2)

**Files:** Create `src/lib/previews.ts`, `tests/unit/previews.test.ts`

**Interfaces:**
- Consumes: `sharp`.
- Produces: `makePreviews(input: Buffer): Promise<{ thumb: Buffer; mediumWebp: Buffer; mediumAvif: Buffer; width:number; height:number }>`, `videoPoster(path: string): Promise<Buffer>` (ffmpeg via child_process, WebP).

- [ ] **Step 1: Test** — feed a generated 4000×3000 test image (`sharp` create), assert thumb longest edge ≤ 350 & bytes < 30_000; medium longest edge ≤ 1280; both decode as valid WebP/AVIF (`sharp(out).metadata()`).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** with `sharp(input).rotate().resize({width|height:350,fit:"inside"}).webp({quality:78})` etc.; medium at 1280 `.webp({quality:80})` and `.avif()`; return original metadata w/h.
- [ ] **Step 4: PASS.** Commit.

---

### Task 7: Search API (BACKEND lane, PHASE 2)

**Files:** Create `src/app/api/search/route.ts`, `tests/integration/search.route.test.ts`
**Consumes:** `embed-client`, `searchByEmbedding`, `getSettings`, `logSearch`, `previewUrl`, `presignGet`, `ratelimit` (Task 10 — if not ready, import a no-op stub interface `checkRateLimit(ip):Promise<boolean>` defined here and later backed by Task 10).
**Produces:** `POST /api/search` (multipart selfie + `guestName`) → `SearchResponse` (200) / 429 (rate-limited) / 422 (no face) / 503 (kill_switch).

- [ ] **Step 1: Test** (mock `embedImage` to return a fixed vector, seed DB with matching + non-matching faces): POST selfie → 200 with only matching photos, `sessionId` present, each match has `thumbUrl` (public) + `previewUrl`. Second: kill_switch on → 503. Third: embed returns 0 faces → 422.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement route**: read settings; if `kill_switch` → 503; `checkRateLimit(ip)` false → 429; `embedImage(selfie)` → `largestFace`; null → 422; store selfie to `shaadi-photos/selfies/<sid>.jpg`; `searchByEmbedding(vec, settings.match_threshold, 500)`; map keys → `previewUrl`/`thumbUrl`; `logSearch({...})`; return `SearchResponse`.
- [ ] **Step 4: PASS.** Commit.

---

### Task 8: Download single + ZIP (BACKEND lane, PHASE 2)

**Files:** Create `src/app/api/download/route.ts`, `src/app/api/download-zip/route.ts`, `tests/integration/download.test.ts`
**Consumes:** `presignGet`, `getObjectStream`, `searchByEmbedding` results persisted per session (store matched `photoId`s on the `search_sessions` row as `matched_ids uuid[]` — add column via migration `0003_matched_ids.sql`), `archiver`, `logDownload`.
**Produces:** `GET /api/download?photoId=` → 302 to presigned original (logged `single`). `GET /api/download-zip?sessionId=` → streamed `application/zip` of that session's matched originals (logged `zip`); if total est. bytes > 1.5 GB or files > 300, respond 200 JSON `{ mode:"prepare", message }` (fallback path).

- [ ] **Step 1: Migration `0003`** adds `search_sessions.matched_ids uuid[]`; update `logSearch` to persist matched ids (amend Task 2 fn signature — coordinate via frozen note).
- [ ] **Step 2: Test** — seed session with 2 matched photos (put 2 tiny objects in mock R2), GET zip → returns zip stream; unzip in test asserts 2 entries. GET single → 302 with Location containing key.
- [ ] **Step 3: FAIL → Implement → Step 4: PASS.** Implement zip via `archiver("zip")`, pipe each `getObjectStream(originalKey)` as an entry named by original filename; stream to a `ReadableStream` response. Commit.

---

### Task 9: Upload API + processing (BACKEND lane, PHASE 2)

**Files:** Create `src/app/api/upload-url/route.ts`, `src/app/api/upload-complete/route.ts`, `tests/integration/upload.test.ts`
**Consumes:** `getSessionQuota`, `presignPut`, `makePreviews`, `embedImage`, `insertPhoto`, `insertFaces`, `insertMedia`, `videoPoster`, `logUpload`, `zod`.
**Produces:** `POST /api/upload-url` (`UploadUrlRequest`) → `UploadUrlResponse` (presigned PUTs, quota-enforced) / 413 over-quota. `POST /api/upload-complete` (`{sessionId, keys[]}`) → processes each: photos → previews + face-index + `insertPhoto/insertFaces`; videos → poster + `insertMedia`; auto-publish; `logUpload`.

- [ ] **Step 1: Test** — session with 18 photos already used, request 5 more → only 2 granted, `remaining.photos===0`, response indicates truncation; video over 300 MB rejected. upload-complete with a known image key (in mock R2) → inserts a photo row + ≥1 face; response `{processed:n}`.
- [ ] **Step 2: FAIL → Implement → PASS.** Enforce: `granted = min(requested, limit - used)`; validate type/size with zod; keys namespaced `uploads/<session>/<uuid>.<ext>`. Commit.

---

### Task 10: Admin API, auth, rate-limit, kill-switch (BACKEND lane, PHASE 2)

**Files:** Create `src/lib/auth.ts`, `src/lib/ratelimit.ts`, `src/app/api/admin/login/route.ts`, `.../admin/logs/route.ts`, `.../admin/settings/route.ts`, `.../admin/delete/route.ts`, `tests/integration/admin.test.ts`
**Produces:** `signAdmin()/verifyAdmin(req)` (jose HS256 httpOnly cookie `shaadi_admin`), `checkRateLimit(ip): Promise<boolean>` (DB: `count(*) from search_sessions where ip=$ and created_at>now()-interval '1 hour' < 30`). Routes: `POST /admin/login` (password → cookie), `GET /admin/logs` (auth; paginated searches/uploads/downloads), `PATCH /admin/settings` (auth; threshold/passcode/kill_switch), `POST /admin/delete` (auth; soft-delete photo + delete R2 objects).

- [ ] **Step 1: Tests** — wrong password → 401; correct → sets cookie; `/admin/logs` without cookie → 401, with cookie → 200 rows; rate-limit returns false after 30 hits/hour; delete flips photo status to 'deleted' and calls R2 delete.
- [ ] **Step 2: FAIL → Implement → PASS.** Commit. **After this, wire `checkRateLimit` into Task 7 (replace stub) — small follow-up commit.**

---

### Task 11: Design system & UI foundation (FRONTEND lane, PHASE 2)

> **REQUIRED:** invoke `frontend-design` and `ui-ux-pro-max` skills first. Aesthetic: warm, celebratory Indian-wedding elegance (deep marigold/maroon + cream + gold accents), refined type pairing, generous spacing, tasteful motion — not templated. Mobile-first, WCAG AA contrast, 44px tap targets.

**Files:** Create/adjust `src/app/globals.css`, `tailwind.config.ts` (theme tokens), `src/components/ui/*` (shadcn: button, input, dialog, skeleton, sonner/toast), `src/components/Brand.tsx`, `src/app/layout.tsx`.
**Produces:** design tokens (colors, radii, shadows, fonts via `next/font`), shared `<Brand/>`, toast provider, skeletons.

- [ ] **Step 1:** Run the two skills; capture the chosen palette (from ui-ux-pro-max's 161 palettes) + font pairing into `tailwind.config.ts` tokens.
- [ ] **Step 2:** Implement tokens + base layout + fonts; add shadcn primitives.
- [ ] **Step 3:** Visual check via Playwright screenshot at 375×812 + 1440×900; assert no layout overflow (`document.scrollingElement.scrollWidth <= innerWidth`). Commit.

---

### Task 12: Home + selfie capture (FRONTEND lane, PHASE 2)

**Files:** Create `src/app/page.tsx`, `src/components/SelfieCapture.tsx`, `tests/e2e/home.spec.ts`
**Consumes:** `POST /api/search` (mock via MSW in dev/test), `SearchResponse`.
**Produces:** name form + `<SelfieCapture>` (getUserMedia front camera live capture + file-upload fallback); on submit → POST → navigate to `/results?sid=`.

- [ ] **Step 1:** invoke frontend-design/ui-ux-pro-max for this screen. Build with camera permission handling, capture-to-blob, preview, retake; upload fallback `<input type=file accept="image/*" capture="user">`. Loading + error states.
- [ ] **Step 2:** e2e (Playwright, fake media via `--use-fake-device-for-media-stream` or file-upload path with a fixture selfie + mocked `/api/search`): enter name, provide selfie, submit → routed to results. Assert. Commit.

---

### Task 13: Results grid + lightbox + download-all (FRONTEND lane, PHASE 2)

**Files:** Create `src/app/results/page.tsx`, `src/components/PhotoGrid.tsx`, `src/components/Lightbox.tsx`, `tests/e2e/results.spec.ts`
**Consumes:** `SearchResponse` (thumbUrl/previewUrl), `GET /api/download`, `GET /api/download-zip`.
**Produces:** responsive masonry grid of **thumbs** (`<picture>` + lazy), sticky "Download all (ZIP)", tap → `<Lightbox>` (medium AVIF/WebP, swipe, per-photo Download original). Skeletons while loading; empty state.

- [ ] **Step 1:** invoke skills for this screen. Build grid (CSS columns/masonry, `content-visibility:auto`, `loading="lazy"`, `sizes` responsive); lightbox with keyboard/swipe; download buttons hit APIs.
- [ ] **Step 2:** e2e with mocked search returning 5 photos: grid shows 5 thumbs, click opens lightbox, "Download all" triggers a zip request (intercept). Assert. Commit.

---

### Task 14: Upload UI (FRONTEND lane, PHASE 2)

**Files:** Create `src/app/upload/page.tsx`, `src/components/UploadDropzone.tsx`, `src/components/QuotaBar.tsx`, `tests/e2e/upload.spec.ts`
**Consumes:** `POST /api/upload-url`, direct R2 PUT, `POST /api/upload-complete`.
**Produces:** picker/dropzone with live quota (20 photos/5 videos), per-file progress, client-side type/size pre-check, success toast.

- [ ] **Step 1:** invoke skills. Build: request grants → PUT each file to its `putUrl` with progress (XHR) → call upload-complete → toast. Disable over-quota selection.
- [ ] **Step 2:** e2e with mocked upload-url + a stub PUT endpoint: select 2 images → uploads succeed, quota decrements. Assert. Commit.

---

### Task 15: Admin dashboard UI (FRONTEND lane, PHASE 2)

**Files:** Create `src/app/admin/login/page.tsx`, `src/app/admin/page.tsx`, `src/components/AdminTable.tsx`, `tests/e2e/admin.spec.ts`
**Consumes:** admin APIs (Task 10).
**Produces:** login form; dashboard with logs table (searches/uploads/downloads, paginated), media browser with delete, settings (threshold slider, passcode toggle, kill-switch).

- [ ] **Step 1:** invoke skills (clean, dense, functional admin aesthetic). Build gated by cookie; redirect to /admin/login if 401.
- [ ] **Step 2:** e2e: login with `ADMIN_PASSWORD` → see logs; toggle kill-switch → PATCH called. Assert. Commit.

---

### Task 16: Local ingest script (INGEST lane, PHASE 2)

**Files:** Create `ingest/main.py`, `ingest/requirements.txt`, `ingest/README.md`, `tests/integration/ingest_smoke.py`
**Consumes:** InsightFace (same buffalo_l), Pillow, `psycopg[binary]`/`pg8000`, `boto3`, Neon + R2 from `.env`.
**Produces:** CLI `python ingest/main.py --root "/path/to/your/photos" [--limit N] [--dry-run]` that for each `*.jpg` (recursing, skipping RAW/system): content-hash → skip if exists → detect+embed faces → make thumb+medium(webp+avif) via Pillow → upload original to `shaadi-photos/originals/<id>.jpg`, previews to `shaadi-previews/...` → insert `photos` + `faces`. Idempotent, resumable, progress bar (`tqdm`), concurrency (thread pool for I/O), `--limit` for a test batch.

- [ ] **Step 1:** Write `main.py` mirroring the embed logic + `previews` sizing (thumb 350 q78, medium 1280 webp q80 + avif). Use `boto3` S3 client to R2 endpoint. Batch DB inserts.
- [ ] **Step 2: Smoke test on 20 photos:** `python ingest/main.py --root "/path/to/your/photos/30th" --limit 20`. Assert: 20 `photos` rows, faces present, previews fetch 200 from public URL. Verify a `searchByEmbedding` from one indexed face returns its own photo.
- [ ] **Step 3: Commit** (do NOT run the full 3,216 yet — that's Task 18 after deploy validated). 

---

### Task 17: End-to-end wiring & full flow tests (PHASE 3, sequential)

**Files:** Create `tests/e2e/full-flow.spec.ts`, `playwright.config.ts` webServer wiring, seed script `tests/seed.ts`.
**Goal:** With real `next dev`, seeded DB (20 ingested photos from Task 16), and the Python embed fn running locally (or a deterministic stub), exercise: Home → selfie (fixture of a known guest) → results shows that guest's photos → open lightbox → download original (200) → download-all zip (valid zip) → upload 2 photos → they appear in a fresh search → admin login → see the new logs → toggle kill-switch → home now shows maintenance.

- [ ] **Step 1:** Write seed + spec. **Step 2:** `pnpm test:e2e` green across all assertions (evidence). **Step 3:** Run `superpowers:verification-before-completion` checklist. Commit.

---

### Task 18: Deploy, pre-warm, CORS lockdown, full ingest (PHASE 3, sequential)

**Files:** Create `vercel.ts`, `src/app/api/warm/route.ts` (pings embed fn + DB), README ops notes.
- [ ] **Step 1:** `vercel.ts` — framework nextjs, Python fn config, `crons: [{path:"/api/warm", schedule:"*/10 * * * *"}]` (pre-warm), env wiring; set `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` for the embed fn.
- [ ] **Step 2:** `vercel deploy` (preview) → smoke the four flows on the preview URL with a handful of real photos.
- [ ] **Step 3:** **Lock CORS** on both R2 buckets to the real deploy origin (replace `*`): regenerate `/tmp/r2-cors.json` with the Vercel/custom domain, `wrangler r2 bucket cors set`.
- [ ] **Step 4:** **Run full ingest** locally: `python ingest/main.py --root "/path/to/your/photos"` (all 3,216). Monitor; verify counts (photos≈3216, faces>0) and spot-check searches.
- [ ] **Step 5:** Promote to production (`vercel deploy --prod`). Rotate Neon password + R2 key if desired. Final `verification-before-completion`. Commit + tag `v1.0.0`.

---

## Self-Review

**Spec coverage:** find-my-photos (T5,7,12,13) · compressed previews vs original download (T6,8,13, previews spec in constraints) · ZIP all (T8,13) · guest uploads w/ limits + face-index (T9,14) · audit logging (T2 tables, T7/8/9/10) · admin + kill-switch + rate-limit + passcode toggle (T10,15) · privacy/biometrics on own infra (T5 local, T16 local) · mobile-first UI w/ frontend-design+ui-ux-pro-max (T11–15) · ingest pendrive (T16,18) · cost/pre-warm (T18). No gap found.

**Placeholder scan:** stubs are explicitly bounded (T7 `checkRateLimit` stub → replaced in T10; T8 amends `logSearch` w/ frozen-note). No open TODOs.

**Type consistency:** `MatchResult`, `EmbedResponse`, `SearchResponse`, `UploadUrl*`, `AdminSettings` defined once in T4 (frozen) and consumed by name everywhere. `searchByEmbedding(embedding, threshold, limit)` signature identical in T2/T7/T16.

**Known coordination points (orchestrator must enforce):** (a) `types.ts` frozen after T4; (b) `logSearch`/`search_sessions.matched_ids` amended in T8 migration 0003 — backend lane runs T7 before T8; (c) T10 rewires T7's rate-limit stub.
