# Reel Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Jeena "Reel maker" (spec §3.G): a full-screen client editor that turns selected gallery photos into a 20–60s MP4 slideshow with a trimmed bundled song, rendered server-side by ffmpeg on the existing EC2 box, with an async job model persisted in Postgres.

**Architecture:** Next.js (Vercel) owns validation, authorization, job state, and R2 signed URLs. Heavy ffmpeg render runs on the EC2 embed-service, reached through a bearer-auth HTTP proxy client that mirrors `src/lib/embed-client.ts` exactly. `POST /api/reel` validates a `ReelSpec` (zod), resolves photo **preview** URLs, inserts a `reel_jobs` row (`queued`), and dispatches the render to EC2 (fire-and-forget: the render POST returns `202` immediately). The render service composes the slideshow, muxes the trimmed audio, uploads the MP4 to R2 (private originals bucket, `reels/` prefix), and calls back `POST /api/reel/callback` (bearer) to flip the job to `done`/`error`. The client polls `GET /api/reel?jobId=` until `{ status: "done", url }`, where `url` is a short-lived signed R2 GET. Rendered reels are admin-visible and logged.

**Tech Stack:** Next.js 15.5 (App Router, `runtime = "nodejs"`), React 19, TypeScript, zod v4, `postgres` (Neon + pgvector), `@aws-sdk/client-s3` (Cloudflare R2), Python 3.11 / FastAPI + ffmpeg + boto3 on EC2 (Docker, behind Caddy HTTPS). Tests: vitest v4 (unit/integration/component) + `aws-sdk-client-mock` + `msw`; Playwright for E2E (render mocked). Package manager: **pnpm**.

## Global Constraints
- **Package manager:** `pnpm` (never npm/yarn). Test runner: `pnpm test` (vitest v4, `vitest run`).
- **Validation:** every request body/query validated with **zod** before use; reuse the repo's `Response.json({ error }, { status })` machine-readable error convention (`src/lib/api.ts` `ApiError` mirrors `error` → `code`).
- **Render transport:** the render service is reached with the **same bearer-auth proxy pattern as `EMBED_FN_URL`/`EMBED_API_KEY`** — a dedicated `src/lib/reel-client.ts` that mirrors `src/lib/embed-client.ts` (AbortController timeout, `Authorization: Bearer <EMBED_API_KEY>` only when the key is set, clean 5xx on unreachable). New env: `REEL_FN_URL` (optional, defaults to `http://127.0.0.1:8000/reel`); the bearer secret is **reused `EMBED_API_KEY`** (same EC2 box, already in Vercel prod env — see resolved ambiguity #2).
- **Async job model:** `POST /api/reel` → `{ jobId }` immediately; client polls `GET /api/reel?jobId=`. Job state lives in a NEW Postgres table **`reel_jobs`** (migration `src/db/migrations/0004_reel_jobs.sql`), run via `src/db/migrate.ts`.
- **Reel bounds:** length **default 20s, min 3s, max 60s**; **max 30 photos**. Aspect **4:5 (1080×1350, default)** or **9:16 (1080×1920)**.
- **Frames:** always sourced from the **compressed public R2 previews** (`previewUrl(preview_key)`), never the private originals; the render service down-res/re-encodes them to a uniform ~90%-quality JPEG before compositing.
- **Output:** H.264 MP4 uploaded to the **private originals bucket** under `reels/<jobId>.mp4`; **never public** — served only via a short-lived `presignGet` signed URL.
- **Songs:** ship a **placeholder catalog now** (silent/royalty-free clips in `public/audio/`); real files are a drop-in replacement, no code change.
- **Testability:** every app-side task is testable WITHOUT the live EC2 box — the render dispatch (`reel-client.ts`) is mocked with `vi.mock`, and R2 with `aws-sdk-client-mock`. The EC2 `/reel` endpoint + deploy is its own task with its own verification.
- **Commits:** conventional-commit subject; every commit ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure

| Path | New/Changed | Purpose |
|---|---|---|
| `src/lib/reel.ts` | **new** | `SongCatalog`, `ReelSpec` + `ReelSpecSchema` (zod), aspect dimensions, `splitDurations` helper. Pure, isomorphic. |
| `src/lib/reel-client.ts` | **new** | Bearer-auth proxy to the render service (mirrors `embed-client.ts`). `dispatchReel(payload)`. |
| `src/lib/env.ts` | changed | Add `REEL_FN_URL` (optional). |
| `src/lib/db.ts` | changed | `insertReelJob`, `getReelJob`, `setReelJobStatus`, `listReels`. |
| `src/lib/types.ts` | changed | `ReelJobStatus`, `CreateReelResponse`, `ReelStatusResponse`, admin `ReelItem`. |
| `src/lib/api.ts` | changed | `createReel(spec)`, `pollReel(jobId)`, `fetchReels()`. |
| `src/db/migrations/0004_reel_jobs.sql` | **new** | `reel_jobs` table + index. |
| `src/app/api/reel/route.ts` | **new** | `POST` (create+dispatch) and `GET` (status → signed url). |
| `src/app/api/reel/callback/route.ts` | **new** | `POST` (render-service callback, bearer). |
| `src/components/ReelMaker.tsx` | **new** | Full-screen editor (strip reorder, length slider, transition, aspect, song trim, progress, Save/Share/Add-to-album). |
| `src/app/results/page.tsx` | changed | "Make reel" launch button (reuses the collage selection flow). |
| `src/app/admin/page.tsx` | changed | "Reels" tab. |
| `src/components/ReelsTable.tsx` | **new** | Admin list of rendered reels. |
| `src/app/api/admin/reels/route.ts` | **new** | `GET` admin reels list (auth-gated like other admin routes). |
| `public/audio/placeholder-1.mp3` | **new** | Placeholder song (silent clip; real file dropped in later). |
| `public/audio/placeholder-2.mp3` | **new** | Placeholder song (silent clip). |
| `embed-service/app.py` | changed | Add `POST /reel` FastAPI route (BackgroundTasks + ffmpeg subprocess + R2 upload + callback). |
| `embed-service/requirements.txt` | changed | Add `boto3`. |
| `embed-service/Dockerfile` | changed | Install `ffmpeg`; document reel env. |
| `embed-service/README.md` | changed | Document `/reel` contract + deploy delta. |
| `tests/unit/reel.test.ts` | **new** | `splitDurations`, `ReelSpecSchema`, aspect dims, song lookup. |
| `tests/unit/reel-client.test.ts` | **new** | dispatch bearer/timeout/error behaviour (mocked fetch). |
| `tests/integration/reel.route.test.ts` | **new** | create/status/callback branches (isolated schema, mocked dispatch + S3). |
| `tests/integration/reel_jobs.db.test.ts` | **new** | db helpers against isolated schema. |
| `tests/components/ReelMaker.test.tsx` | **new** | editor state + create call. |
| `tests/e2e/reel.spec.ts` | **new** | create→poll→result with render mocked. |

---

## Task 1 — Reel data model & pure helpers (`src/lib/reel.ts`)

**Files:** `src/lib/reel.ts` (new), `tests/unit/reel.test.ts` (new), `public/audio/placeholder-1.mp3` + `public/audio/placeholder-2.mp3` (new assets).

**Interfaces**
- **Produces:**
  ```ts
  // src/lib/reel.ts
  import { z } from "zod";

  export const ASPECTS = ["4:5", "9:16"] as const;
  export type Aspect = (typeof ASPECTS)[number];

  export const TRANSITIONS = ["crossfade", "kenburns", "cut"] as const;
  export type Transition = (typeof TRANSITIONS)[number];

  export const MIN_SECONDS = 3;
  export const DEFAULT_SECONDS = 20;
  export const MAX_SECONDS = 60;
  export const MAX_PHOTOS = 30;

  export interface Song {
    id: string;
    title: string;
    artist: string;
    /** Public path served by the Next app; "" means no audio track. */
    src: string;
    /** Seconds; 0 for the silent option. */
    duration: number;
  }

  export const SONG_CATALOG: Song[] = [
    { id: "silent", title: "No music", artist: "—", src: "", duration: 0 },
    { id: "placeholder-1", title: "First Dance (placeholder)", artist: "Jeena", src: "/audio/placeholder-1.mp3", duration: 60 },
    { id: "placeholder-2", title: "Golden Hour (placeholder)", artist: "Jeena", src: "/audio/placeholder-2.mp3", duration: 60 },
  ];

  export function songById(id: string): Song | undefined {
    return SONG_CATALOG.find((s) => s.id === id);
  }

  export const ReelSpecSchema = z.object({
    photoIds: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS),
    aspect: z.enum(ASPECTS).default("4:5"),
    totalSeconds: z.number().int().min(MIN_SECONDS).max(MAX_SECONDS).default(DEFAULT_SECONDS),
    transition: z.enum(TRANSITIONS).default("kenburns"),
    /** Optional per-photo weights; when present must match photoIds length. */
    perPhoto: z.array(z.number().positive()).optional(),
    song: z.object({ id: z.string().min(1), startSec: z.number().min(0).default(0) }),
  }).refine(
    (s) => !s.perPhoto || s.perPhoto.length === s.photoIds.length,
    { message: "perPhoto length must match photoIds", path: ["perPhoto"] },
  );
  export type ReelSpec = z.infer<typeof ReelSpecSchema>;

  export function aspectDimensions(aspect: Aspect): { width: number; height: number } {
    return aspect === "9:16" ? { width: 1080, height: 1920 } : { width: 1080, height: 1350 };
  }

  /**
   * Seconds to show each photo. Even split by default; when `perPhoto` weights
   * are given they are normalized so the durations sum to exactly totalSeconds.
   */
  export function splitDurations(totalSeconds: number, count: number, perPhoto?: number[]): number[] {
    if (count <= 0) return [];
    if (perPhoto && perPhoto.length === count) {
      const sum = perPhoto.reduce((a, b) => a + b, 0);
      if (sum <= 0) return new Array(count).fill(totalSeconds / count);
      return perPhoto.map((w) => (w / sum) * totalSeconds);
    }
    return new Array(count).fill(totalSeconds / count);
  }
  ```

**Steps**
- [ ] **Step: write failing test** `tests/unit/reel.test.ts` covering `splitDurations` (even split: `splitDurations(20,4)` → `[5,5,5,5]`; weighted: `splitDurations(20,2,[1,3])` → `[5,15]`; sum invariant: any output sums to `totalSeconds` within `1e-9`; `count<=0` → `[]`; zero/negative weights fall back to even), `aspectDimensions` (both aspects), `songById` (hit + miss), and `ReelSpecSchema` (defaults applied; rejects `totalSeconds` 61 and 2; rejects empty/31-item `photoIds`; rejects `perPhoto` length mismatch; parses a valid spec). Import from `@/lib/reel`.
- [ ] **Step: run test — fails** (`pnpm test tests/unit/reel.test.ts`): module not found.
- [ ] **Step: implement** `src/lib/reel.ts` exactly as above.
- [ ] **Step: create placeholder audio assets.** Generate two 60s silent MP3s (real songs dropped in later, same filenames):
  ```bash
  mkdir -p public/audio
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 60 -c:a libmp3lame -q:a 9 public/audio/placeholder-1.mp3
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 60 -c:a libmp3lame -q:a 9 public/audio/placeholder-2.mp3
  ```
  (If system `ffmpeg` is absent, use the bundled binary: `node -e "console.log(require('ffmpeg-static'))"` and run that path.)
- [ ] **Step: run test — passes.**
- [ ] **Step: commit** — `feat(reel): reel data model, song catalog, duration split + placeholder audio`.

---

## Task 2 — `reel_jobs` migration + db helpers

**Files:** `src/db/migrations/0004_reel_jobs.sql` (new), `src/lib/db.ts` (changed), `tests/integration/reel_jobs.db.test.ts` (new).

**Interfaces**
- **Produces — migration** `src/db/migrations/0004_reel_jobs.sql`:
  ```sql
  create table reel_jobs (
    id uuid primary key default gen_random_uuid(),
    status text not null default 'queued'
      check (status in ('queued','rendering','done','error')),
    spec jsonb not null,
    output_key text,
    error text,
    session_id uuid,
    guest_name text,
    ip text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists reel_jobs_status_created on reel_jobs(status, created_at desc);
  ```
- **Produces — db helpers** (append to `src/lib/db.ts`):
  ```ts
  export type ReelJobStatus = "queued" | "rendering" | "done" | "error";

  export interface InsertReelJobInput {
    spec: unknown;                 // the validated ReelSpec, stored as jsonb
    sessionId?: string | null;
    guestName?: string | null;
    ip?: string | null;
  }
  export async function insertReelJob(x: InsertReelJobInput): Promise<{ id: string }> {
    const rows = await sql<{ id: string }[]>`
      insert into reel_jobs (spec, session_id, guest_name, ip)
      values (${sql.json(x.spec as object)}, ${x.sessionId ?? null}, ${x.guestName ?? null}, ${x.ip ?? null})
      returning id`;
    return rows[0];
  }

  export interface ReelJobRow {
    id: string;
    status: ReelJobStatus;
    output_key: string | null;
    error: string | null;
  }
  export async function getReelJob(id: string): Promise<ReelJobRow | null> {
    const rows = await sql<ReelJobRow[]>`
      select id, status, output_key, error from reel_jobs where id = ${id}`;
    return rows[0] ?? null;
  }

  export async function setReelJobStatus(
    id: string,
    patch: { status: ReelJobStatus; outputKey?: string | null; error?: string | null },
  ): Promise<void> {
    await sql`
      update reel_jobs set
        status = ${patch.status},
        output_key = coalesce(${patch.outputKey ?? null}, output_key),
        error = coalesce(${patch.error ?? null}, error),
        updated_at = now()
      where id = ${id}`;
  }

  export interface ReelListRow {
    id: string;
    guest_name: string | null;
    output_key: string | null;
    created_at: Date;
  }
  export async function listReels(opts: { limit?: number; offset?: number } = {}): Promise<ReelListRow[]> {
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;
    return sql<ReelListRow[]>`
      select id, guest_name, output_key, created_at
      from reel_jobs
      where status = 'done'
      order by created_at desc
      limit ${limit} offset ${offset}`;
  }
  ```

**Steps**
- [ ] **Step: write failing test** `tests/integration/reel_jobs.db.test.ts` (mirror the schema harness in `tests/integration/search.route.test.ts`: `// @vitest-environment node`, unique `TEST_SCHEMA = "shaadi_test_reel_db"`, `beforeAll` creates the schema and runs every `src/db/migrations/*.sql` in sorted order through a throwaway admin client, sets `process.env.DB_SCHEMA` before importing `@/lib/db`, `afterAll` drops the schema). Assert: `insertReelJob` returns an id and the row is `queued`; `getReelJob` returns it; `setReelJobStatus(id, {status:"done", outputKey:"reels/x.mp4"})` flips status + stores key and `getReelJob` reflects it; `setReelJobStatus(id, {status:"error", error:"boom"})`; `listReels` returns only `done` rows, newest first.
- [ ] **Step: run test — fails**: `reel_jobs` table / helpers missing.
- [ ] **Step: implement** the migration file and the db helpers above.
- [ ] **Step: run test — passes** (`pnpm test tests/integration/reel_jobs.db.test.ts`).
- [ ] **Step: apply migration to the real DB** locally: `pnpm dlx tsx src/db/migrate.ts` (prints `applied 0004_reel_jobs`).
- [ ] **Step: commit** — `feat(reel): reel_jobs migration + job db helpers`.

---

## Task 3 — Render-service client (`src/lib/reel-client.ts`) + env

**Files:** `src/lib/reel-client.ts` (new), `src/lib/env.ts` (changed), `tests/unit/reel-client.test.ts` (new).

**Interfaces**
- **Consumes:** `loadEnv().REEL_FN_URL`, `loadEnv().EMBED_API_KEY`.
- **Produces:**
  ```ts
  // src/lib/env.ts — add inside the Schema object:
  REEL_FN_URL: z.string().url().optional(),
  ```
  ```ts
  // src/lib/reel-client.ts
  import { loadEnv } from "./env";

  const DEFAULT_REEL_FN_URL = "http://127.0.0.1:8000/reel";
  const REEL_DISPATCH_TIMEOUT_MS = 15_000; // dispatch only returns 202; render runs async

  export interface ReelFrame { url: string; seconds: number }
  export interface ReelDispatchPayload {
    jobId: string;
    aspect: "4:5" | "9:16";
    width: number;
    height: number;
    totalSeconds: number;
    transition: "crossfade" | "kenburns" | "cut";
    frames: ReelFrame[];
    audio: { url: string | null; startSec: number };
    outputKey: string;      // reels/<jobId>.mp4
    callbackUrl: string;    // https://<app>/api/reel/callback
  }

  function reelFnUrl(): string {
    return loadEnv().REEL_FN_URL ?? DEFAULT_REEL_FN_URL;
  }

  /**
   * Dispatch a render to the EC2 service. Mirrors embed-client.ts: bearer auth
   * only when EMBED_API_KEY is set, AbortController timeout, clean throw on
   * unreachable. The service returns 202 immediately and renders in the
   * background, calling back /api/reel/callback on completion.
   */
  export async function dispatchReel(payload: ReelDispatchPayload): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REEL_DISPATCH_TIMEOUT_MS);
    const apiKey = loadEnv().EMBED_API_KEY;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    let res: Response;
    try {
      res = await fetch(reelFnUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`reel dispatch timed out after ${REEL_DISPATCH_TIMEOUT_MS}ms`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
    if (res.status !== 202 && !res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = `: ${body.error}`;
      } catch { /* non-JSON error body */ }
      throw new Error(`reel service returned ${res.status}${detail}`);
    }
  }
  ```

**Steps**
- [ ] **Step: write failing test** `tests/unit/reel-client.test.ts` (mirror `tests/unit/embed-client.test.ts`: `// @vitest-environment node`, re-import module per test after setting env via `vi.stubEnv`/reset registry). Cases: (a) with `EMBED_API_KEY` set, `fetch` is called with `Authorization: Bearer <key>` and JSON body containing `jobId`; (b) without the key, no `authorization` header; (c) a `202` response resolves; (d) a `500 {error}` response throws with the status + detail; (e) a thrown/aborted fetch surfaces a clean error. Stub global `fetch` with `vi.fn`.
- [ ] **Step: run test — fails**: module missing.
- [ ] **Step: implement** the `env.ts` addition and `src/lib/reel-client.ts`.
- [ ] **Step: run test — passes.**
- [ ] **Step: commit** — `feat(reel): render-service dispatch client (bearer proxy) + REEL_FN_URL env`.

---

## Task 4 — `POST /api/reel` (create+dispatch) and `GET /api/reel` (status)

**Files:** `src/app/api/reel/route.ts` (new), `src/lib/types.ts` (changed), `tests/integration/reel.route.test.ts` (new).

**Interfaces**
- **Consumes:** `ReelSpecSchema`, `aspectDimensions`, `splitDurations`, `songById` (`@/lib/reel`); `getSettings`, `getPhotosByIds`, `insertReelJob`, `getReelJob`, `setReelJobStatus` (`@/lib/db`); `previewUrl`, `presignGet` (`@/lib/r2`); `dispatchReel` (`@/lib/reel-client`); `checkRateLimit` (`@/lib/ratelimit`); `loadEnv` (`@/lib/env`).
- **Produces — types** (`src/lib/types.ts`):
  ```ts
  export type ReelJobStatus = "queued" | "rendering" | "done" | "error";
  export type CreateReelResponse = { jobId: string };
  export type ReelStatusResponse = { status: ReelJobStatus; url?: string; error?: string };
  ```
- **Produces — route** `src/app/api/reel/route.ts`:
  ```ts
  import { z } from "zod";
  import {
    getPhotosByIds, getReelJob, getSettings, insertReelJob, setReelJobStatus,
  } from "@/lib/db";
  import { loadEnv } from "@/lib/env";
  import { previewUrl, presignGet } from "@/lib/r2";
  import { checkRateLimit } from "@/lib/ratelimit";
  import { aspectDimensions, ReelSpecSchema, songById, splitDurations } from "@/lib/reel";
  import { dispatchReel } from "@/lib/reel-client";
  import type { CreateReelResponse, ReelStatusResponse } from "@/lib/types";

  export const runtime = "nodejs";

  const REEL_URL_EXPIRY_SECONDS = 3600; // 1h signed playback/download URL

  function clientIp(req: Request): string | null {
    const fwd = req.headers.get("x-forwarded-for");
    if (fwd) { const first = fwd.split(",")[0]?.trim(); if (first) return first; }
    return req.headers.get("x-real-ip")?.trim() || null;
  }

  /** App origin as seen by an external caller — used to build public audio URLs
   *  and the render callback URL the EC2 box will hit. */
  function appOrigin(req: Request): string {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    return `${proto}://${host}`;
  }

  export async function POST(req: Request): Promise<Response> {
    if ((await getSettings()).killSwitch) {
      return Response.json({ error: "maintenance" }, { status: 503 });
    }
    const ip = clientIp(req);
    if (!(await checkRateLimit(ip))) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }

    let spec: z.infer<typeof ReelSpecSchema>;
    try {
      spec = ReelSpecSchema.parse(await req.json());
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    // Resolve preview keys for the requested photos; reorder to match photoIds
    // and reject if any id is unknown/inactive (can't render a missing frame).
    const rows = await getPhotosByIds(spec.photoIds);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = spec.photoIds.map((id) => byId.get(id));
    if (ordered.some((r) => !r)) {
      return Response.json({ error: "unknown_photo" }, { status: 400 });
    }

    const { width, height } = aspectDimensions(spec.aspect);
    const durations = splitDurations(spec.totalSeconds, spec.photoIds.length, spec.perPhoto);
    const frames = ordered.map((r, i) => ({ url: previewUrl(r!.preview_key), seconds: durations[i] }));

    const song = songById(spec.song.id);
    const audioUrl = song && song.src ? `${appOrigin(req)}${song.src}` : null;

    const { id: jobId } = await insertReelJob({ spec, ip, guestName: null });
    const outputKey = `reels/${jobId}.mp4`;

    try {
      await dispatchReel({
        jobId, aspect: spec.aspect, width, height,
        totalSeconds: spec.totalSeconds, transition: spec.transition,
        frames, audio: { url: audioUrl, startSec: spec.song.startSec },
        outputKey, callbackUrl: `${appOrigin(req)}/api/reel/callback`,
      });
      await setReelJobStatus(jobId, { status: "rendering" });
    } catch (err) {
      console.error("reel: dispatch failed:", err);
      await setReelJobStatus(jobId, { status: "error", error: "render_dispatch_failed" });
      return Response.json({ error: "render_unavailable" }, { status: 502 });
    }

    const body: CreateReelResponse = { jobId };
    return Response.json(body, { status: 202 });
  }

  export async function GET(req: Request): Promise<Response> {
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId || !z.string().uuid().safeParse(jobId).success) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const job = await getReelJob(jobId);
    if (!job) return Response.json({ error: "not_found" }, { status: 404 });

    const body: ReelStatusResponse =
      job.status === "done" && job.output_key
        ? { status: "done", url: await presignGet(job.output_key, { expiresIn: REEL_URL_EXPIRY_SECONDS }) }
        : job.status === "error"
          ? { status: "error", error: job.error ?? "render_failed" }
          : { status: job.status };
    return Response.json(body, { status: 200 });
  }
  ```
- **Render request JSON** (Next → EC2, from `dispatchReel`): see Task 3 `ReelDispatchPayload`. **202 response:** `{ "accepted": true, "jobId": "<uuid>" }`.

**Steps**
- [ ] **Step: write failing test** `tests/integration/reel.route.test.ts` (schema harness like Task 2, `TEST_SCHEMA = "shaadi_test_reel_route"`; `vi.mock("@/lib/reel-client", ...)` so `dispatchReel` is a `vi.fn`; `mockClient(S3Client)` from `aws-sdk-client-mock` for `presignGet`). Seed two active `photos` rows via `insertPhoto`. Cases:
  - kill switch on → `503 {error:"maintenance"}`.
  - invalid body (missing `song`, `totalSeconds:61`) → `400 {error:"invalid_request"}`.
  - unknown photo id → `400 {error:"unknown_photo"}`.
  - happy path → `202 {jobId}`; `dispatchReel` called once with `frames.length === photoIds.length`, each `frames[i].url` a preview URL, `outputKey === "reels/<jobId>.mp4"`, `callbackUrl` ends `/api/reel/callback`; the `reel_jobs` row is `rendering`.
  - dispatch throws → `502 {error:"render_unavailable"}` and row is `error`.
  - `GET ?jobId=` for a `rendering` job → `{status:"rendering"}` (no url).
  - `GET` after `setReelJobStatus(done)` → `{status:"done", url}` (a signed URL string).
  - `GET` bad/missing jobId → `400`; unknown → `404`.
- [ ] **Step: run test — fails**: route missing.
- [ ] **Step: implement** the `types.ts` additions and `src/app/api/reel/route.ts`.
- [ ] **Step: run test — passes** (`pnpm test tests/integration/reel.route.test.ts`).
- [ ] **Step: commit** — `feat(reel): POST /api/reel create+dispatch and GET status route`.

---

## Task 5 — `POST /api/reel/callback` (render-service callback)

**Files:** `src/app/api/reel/callback/route.ts` (new); extend `tests/integration/reel.route.test.ts`.

**Interfaces**
- **Consumes:** `setReelJobStatus`, `getReelJob` (`@/lib/db`); `loadEnv` (`@/lib/env`).
- **Callback request JSON** (EC2 → Next), header `Authorization: Bearer <EMBED_API_KEY>`:
  ```json
  { "jobId": "<uuid>", "status": "done",  "outputKey": "reels/<uuid>.mp4" }
  { "jobId": "<uuid>", "status": "error", "error": "ffmpeg exited 1: ..." }
  ```
  Response: `{ "ok": true }` (200) or `{ "error": "..." }`.
- **Produces** `src/app/api/reel/callback/route.ts`:
  ```ts
  import { z } from "zod";
  import { getReelJob, setReelJobStatus } from "@/lib/db";
  import { loadEnv } from "@/lib/env";

  export const runtime = "nodejs";

  const CallbackSchema = z.object({
    jobId: z.string().uuid(),
    status: z.enum(["done", "error"]),
    outputKey: z.string().min(1).optional(),
    error: z.string().optional(),
  });

  function authorized(req: Request): boolean {
    const key = loadEnv().EMBED_API_KEY;
    if (!key) return true; // dev/local convenience, matches embed-service
    return req.headers.get("authorization") === `Bearer ${key}`;
  }

  export async function POST(req: Request): Promise<Response> {
    if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: z.infer<typeof CallbackSchema>;
    try {
      body = CallbackSchema.parse(await req.json());
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    if (!(await getReelJob(body.jobId))) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    await setReelJobStatus(body.jobId, {
      status: body.status,
      outputKey: body.outputKey ?? null,
      error: body.error ?? null,
    });
    return Response.json({ ok: true }, { status: 200 });
  }
  ```

**Steps**
- [ ] **Step: write failing test** (append to `tests/integration/reel.route.test.ts`): with `EMBED_API_KEY` set in env, a callback missing/wrong bearer → `401`; a `done` callback with `outputKey` flips the job to `done` and stores the key (verify via `getReelJob`); an `error` callback stores the error; unknown jobId → `404`; malformed body → `400`.
- [ ] **Step: run test — fails**: route missing.
- [ ] **Step: implement** `src/app/api/reel/callback/route.ts`.
- [ ] **Step: run test — passes.**
- [ ] **Step: commit** — `feat(reel): render-service callback route (bearer-authed job update)`.

---

## Task 6 — Client API functions (`src/lib/api.ts`)

**Files:** `src/lib/api.ts` (changed), `src/lib/types.ts` (already extended in Task 4); extend `tests/unit` with `tests/unit/reel-api.test.ts` (new).

**Interfaces**
- **Produces** (append to `src/lib/api.ts`):
  ```ts
  import type { CreateReelResponse, ReelStatusResponse } from "@/lib/types";
  import type { ReelSpec } from "@/lib/reel";

  export async function createReel(spec: ReelSpec): Promise<CreateReelResponse> {
    return asJson<CreateReelResponse>(
      await fetch("/api/reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      }),
    );
  }

  export async function pollReel(jobId: string): Promise<ReelStatusResponse> {
    return asJson<ReelStatusResponse>(
      await fetch(`/api/reel?jobId=${encodeURIComponent(jobId)}`),
    );
  }

  export type ReelItem = {
    id: string;
    guest: string | null;
    url: string;         // signed playback URL
    createdAt: string;
  };
  export async function fetchReels(): Promise<{ reels: ReelItem[] }> {
    return asJson<{ reels: ReelItem[] }>(await fetch("/api/admin/reels"));
  }
  ```
  Add `ReelItem` to `src/lib/types.ts` if preferred there; keep it colocated with the other admin item types.

**Steps**
- [ ] **Step: write failing test** `tests/unit/reel-api.test.ts` (jsdom; stub `global.fetch`): `createReel` POSTs JSON to `/api/reel` and returns `{jobId}`; a non-ok response throws `ApiError` with the mirrored `code`; `pollReel` GETs `/api/reel?jobId=...` and returns the status body.
- [ ] **Step: run test — fails**: functions missing.
- [ ] **Step: implement** the api.ts additions.
- [ ] **Step: run test — passes.**
- [ ] **Step: commit** — `feat(reel): client api (createReel, pollReel, fetchReels)`.

---

## Task 7 — `ReelMaker.tsx` editor + Results launch

**Files:** `src/components/ReelMaker.tsx` (new), `src/app/results/page.tsx` (changed), `tests/components/ReelMaker.test.tsx` (new).

**Interfaces**
- **Consumes:** `createReel`, `pollReel` (`@/lib/api`); `SONG_CATALOG`, `songById`, `ASPECTS`, `TRANSITIONS`, `DEFAULT_SECONDS`, `MIN_SECONDS`, `MAX_SECONDS`, `MAX_PHOTOS`, `aspectDimensions`, `splitDurations`, `type Aspect`, `type Transition`, `type ReelSpec` (`@/lib/reel`); `Button`, `Slider` (`@/components/ui/*`); `toast` (`sonner`).
- **Produces — component props:**
  ```ts
  type Photo = import("@/lib/types").SearchResponse["matches"][number];
  export function ReelMaker(props: { photos: Photo[]; guestName: string; onClose: () => void }): JSX.Element;
  ```
  Internal state: ordered `photoIds` (reorderable strip, add/remove), `aspect` (default `"4:5"`), `totalSeconds` (default `DEFAULT_SECONDS`, slider `MIN_SECONDS..MAX_SECONDS`), `transition` (default `"kenburns"`), `songId` (default `"silent"`), `songStartSec` (waveform-trim start; clip auto-fit = `totalSeconds`, clamp `startSec` to `max(0, duration - totalSeconds)`), and a render phase `"editing" | "rendering" | "done" | "error"`.
  Behaviours: build `ReelSpec` from state; `createReel(spec)` → begin polling `pollReel(jobId)` on an interval (e.g. 2s) until `status==="done"` (show `<video src={url}>` + Save/Share/Add-to-album) or `"error"` (toast + back to editing). Per-photo duration preview via `splitDurations`. Audio preview via a hidden `<audio>` seeked to `songStartSec`. Full-screen overlay chrome consistent with `CollageMaker.tsx` (fixed inset, backdrop, close button, brand palette tokens `--rose`/`--maroon`).
- **Produces — Results launch** (`src/app/results/page.tsx`): reuse the existing `selecting`/`selected`/`selectedPhotos` collage flow; add a `reelOpen` state and a "Make reel" button next to "Make collage" (enabled when `selected.size >= 1`, capped at `MAX_PHOTOS`), and render `{reelOpen && <ReelMaker photos={selectedPhotos} guestName={guestName} onClose={() => { setReelOpen(false); cancelSelecting(); }} />}` mirroring the CollageMaker block.

**Steps**
- [ ] **Step: write failing component test** `tests/components/ReelMaker.test.tsx` (testing-library + jsdom; mock `@/lib/api` `createReel`/`pollReel`). Render with 3 fake photos. Assert: default length label shows 20s and default aspect 4:5; moving the length slider updates the per-photo duration hint; a remove control drops a photo from the strip; clicking "Create reel" calls `createReel` once with a spec whose `photoIds.length === 3`, `aspect === "4:5"`, `totalSeconds === 20`; when `pollReel` resolves `{status:"done", url}`, a `<video>` with that `src` appears and Save/Share/Add-to-album controls render; when it resolves `{status:"error"}`, an error state shows and the editor is interactive again.
- [ ] **Step: run test — fails**: component missing.
- [ ] **Step: implement** `src/components/ReelMaker.tsx` and wire the Results launch button. Keep the strip reorder minimal but real (up/down or drag using native DnD); "Add to album" calls the existing gallery path is deferred to Task 9 admin visibility — here it can toast "saved to album" and rely on the reel already being in `reel_jobs` (admin-visible).
- [ ] **Step: run test — passes** (`pnpm test tests/components/ReelMaker.test.tsx`).
- [ ] **Step: verify build** — `pnpm build` compiles (no type errors from the new imports).
- [ ] **Step: commit** — `feat(reel): ReelMaker editor + Results launch button`.

---

## Task 8 — Admin visibility of rendered reels

**Files:** `src/app/api/admin/reels/route.ts` (new), `src/components/ReelsTable.tsx` (new), `src/app/admin/page.tsx` (changed), `src/lib/api.ts` (already has `fetchReels` from Task 6); extend `tests/integration` with `tests/integration/admin_reels.test.ts` (new).

**Interfaces**
- **Consumes:** `listReels` (`@/lib/db`); `presignGet` (`@/lib/r2`); the admin auth guard used by the other `src/app/api/admin/*` routes (mirror `src/app/api/admin/media/route.ts`).
- **Produces — route** `src/app/api/admin/reels/route.ts`:
  ```ts
  import { listReels } from "@/lib/db";
  import { presignGet } from "@/lib/r2";
  import { requireAdmin } from "@/lib/auth"; // same guard other admin routes use
  export const runtime = "nodejs";
  export async function GET(req: Request): Promise<Response> {
    const denied = await requireAdmin(req);   // match the existing admin routes' pattern
    if (denied) return denied;
    const rows = await listReels({ limit: 200 });
    const reels = await Promise.all(
      rows
        .filter((r) => r.output_key)
        .map(async (r) => ({
          id: r.id,
          guest: r.guest_name,
          url: await presignGet(r.output_key as string, { expiresIn: 3600 }),
          createdAt: r.created_at.toISOString(),
        })),
    );
    return Response.json({ reels }, { status: 200 });
  }
  ```
  (Match whatever the sibling admin routes actually use for auth — confirm `src/app/api/admin/media/route.ts` and reuse the identical guard call/shape.)
- **Produces — admin UI:** add `"reels"` to the `Tab` union in `src/app/admin/page.tsx`, fetch via `fetchReels()`, render `<ReelsTable reels={reels} />` (a grid of `<video controls src={url} />` with guest + date). Log/treat like a guest video upload for parity (reels already live in `reel_jobs`; no `media` row needed — the admin tab is the visibility surface required by §3.G).

**Steps**
- [ ] **Step: write failing test** `tests/integration/admin_reels.test.ts` (schema harness; seed a `done` reel job via `insertReelJob` + `setReelJobStatus`; mock S3 for `presignGet`; supply a valid admin session/cookie exactly as `tests/integration/admin_media.test.ts` does). Assert: unauthenticated → the same denial the other admin routes give; authenticated → `{reels:[...]}` with one signed `url`, and `queued`/`rendering` jobs are excluded.
- [ ] **Step: run test — fails**: route missing.
- [ ] **Step: implement** the admin route, `ReelsTable.tsx`, and the admin-page tab.
- [ ] **Step: run test — passes.**
- [ ] **Step: commit** — `feat(admin): Reels tab showing rendered reels (signed playback)`.

---

## Task 9 — EC2 render service: `POST /reel` (ffmpeg) + deploy

> Independent of the app-side tasks; app tasks are fully testable with `dispatchReel` mocked. This task adds the real endpoint and deploys it. Its automated tests are limited (ffmpeg + network) — verification is a live curl on the box.

**Files:** `embed-service/app.py` (changed), `embed-service/requirements.txt` (changed), `embed-service/Dockerfile` (changed), `embed-service/README.md` (changed).

**Interfaces**
- **Request** (`POST /reel`, header `Authorization: Bearer <EMBED_API_KEY>` when set) — the `ReelDispatchPayload` JSON from Task 3.
- **Response:** `202 {"accepted": true, "jobId": "<uuid>"}` (renders in a FastAPI `BackgroundTasks` job); on bad input `400 {"error": "..."}`; on missing/wrong bearer `401 {"error": "unauthorized"}`.
- **Callback:** on completion the job POSTs the payload's `callbackUrl` with `Authorization: Bearer <EMBED_API_KEY>` and body `{jobId, status:"done", outputKey}` or `{jobId, status:"error", error}` (Task 5 contract).
- **Env added to the container:** `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_ORIGINALS` (reels go to the private originals bucket). `EMBED_API_KEY` reused. `MODEL_BASE_URL`/`INSIGHTFACE_HOME` unchanged.

**Produces — `embed-service/app.py` additions** (real code):
```python
import subprocess
import tempfile
import boto3
from fastapi import BackgroundTasks

R2_ENDPOINT = os.environ.get("R2_ENDPOINT")
R2_BUCKET_ORIGINALS = os.environ.get("R2_BUCKET_ORIGINALS", "shaadi-photos")

def _r2():
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )

def _download_and_normalize(url: str, dest: str, width: int, height: int) -> None:
    """Fetch a preview and re-encode to a uniform cover-cropped ~90% JPEG."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        img = Image.open(io.BytesIO(resp.read())).convert("RGB")
    img = ImageOps.exif_transpose(img)
    img = ImageOps.fit(img, (width, height), method=Image.LANCZOS)  # cover-crop
    img.save(dest, "JPEG", quality=90)

def _build_ffmpeg_cmd(frames, audio, width, height, transition, total_seconds, out_path):
    """Compose the slideshow. Uniform WxH JPEG inputs (already cover-cropped)."""
    n = len(frames)
    xfade = 0.6  # crossfade seconds
    inputs = []
    for i, f in enumerate(frames):
        # Each still shown for its segment; +xfade padding on crossfade so the
        # overlap doesn't shorten a clip.
        dur = f["seconds"] + (xfade if transition == "crossfade" and i < n - 1 else 0)
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", f["path"]]

    filters = []
    if transition == "kenburns":
        fps = 30
        for i, f in enumerate(frames):
            d = max(1, int(f["seconds"] * fps))
            filters.append(
                f"[{i}:v]scale={width}:{height},setsar=1,"
                f"zoompan=z='min(zoom+0.0015,1.5)':d={d}:"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps={fps}[v{i}]"
            )
        labels = "".join(f"[v{i}]" for i in range(n))
        filters.append(f"{labels}concat=n={n}:v=1:a=0[vout]")
    elif transition == "crossfade":
        for i in range(n):
            filters.append(f"[{i}:v]scale={width}:{height},setsar=1,fps=30[v{i}]")
        prev, offset = "[v0]", 0.0
        for i in range(1, n):
            offset += frames[i - 1]["seconds"]
            out = "[vout]" if i == n - 1 else f"[x{i}]"
            filters.append(f"{prev}[v{i}]xfade=transition=fade:duration={xfade}:offset={offset:.3f}{out}")
            prev = out
        if n == 1:
            filters.append("[v0]null[vout]")
    else:  # cut
        for i in range(n):
            filters.append(f"[{i}:v]scale={width}:{height},setsar=1,fps=30[v{i}]")
        labels = "".join(f"[v{i}]" for i in range(n))
        filters.append(f"{labels}concat=n={n}:v=1:a=0[vout]")

    cmd = ["ffmpeg", "-y", *inputs]
    audio_idx = None
    if audio and audio.get("path"):
        audio_idx = n
        cmd += ["-ss", str(audio.get("startSec", 0)), "-t", str(total_seconds), "-i", audio["path"]]
    cmd += ["-filter_complex", ";".join(filters), "-map", "[vout]"]
    if audio_idx is not None:
        cmd += ["-map", f"{audio_idx}:a", "-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
            "-movflags", "+faststart", out_path]
    return cmd

def _callback(url: str, body: dict) -> None:
    data = json.dumps(body).encode()
    headers = {"content-type": "application/json"}
    if EMBED_API_KEY:
        headers["authorization"] = f"Bearer {EMBED_API_KEY}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # noqa: BLE001
        print(f"reel callback failed: {e}")

def _render_job(spec: dict) -> None:
    job_id = spec["jobId"]
    cb = spec.get("callbackUrl")
    try:
        with tempfile.TemporaryDirectory() as work:
            w, h = spec["width"], spec["height"]
            frames = []
            for i, fr in enumerate(spec["frames"]):
                p = os.path.join(work, f"f{i}.jpg")
                _download_and_normalize(fr["url"], p, w, h)
                frames.append({"path": p, "seconds": fr["seconds"]})
            audio = None
            au = spec.get("audio") or {}
            if au.get("url"):
                ap = os.path.join(work, "audio.src")
                req = urllib.request.Request(au["url"], headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req) as r, open(ap, "wb") as out:
                    shutil.copyfileobj(r, out)
                audio = {"path": ap, "startSec": au.get("startSec", 0)}
            out_path = os.path.join(work, "out.mp4")
            cmd = _build_ffmpeg_cmd(frames, audio, w, h, spec["transition"],
                                    spec["totalSeconds"], out_path)
            proc = subprocess.run(cmd, capture_output=True)
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.decode()[-500:])
            _r2().upload_file(out_path, R2_BUCKET_ORIGINALS, spec["outputKey"],
                              ExtraArgs={"ContentType": "video/mp4"})
        if cb:
            _callback(cb, {"jobId": job_id, "status": "done", "outputKey": spec["outputKey"]})
    except Exception as e:  # noqa: BLE001
        print(f"reel render failed for {job_id}: {e}")
        if cb:
            _callback(cb, {"jobId": job_id, "status": "error", "error": str(e)[:500]})

@app.post("/reel")
async def reel(request: Request, background_tasks: BackgroundTasks):
    if not _authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        spec = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    if not spec.get("jobId") or not spec.get("frames"):
        return JSONResponse({"error": "jobId and frames required"}, status_code=400)
    background_tasks.add_task(_render_job, spec)
    return JSONResponse({"accepted": True, "jobId": spec["jobId"]}, status_code=202)
```

**Produces — `requirements.txt`:** add `boto3==1.35.*`.
**Produces — `Dockerfile`:** add `ffmpeg` to the runtime `apt-get install` line:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
```

**Steps**
- [ ] **Step: implement** the `app.py` additions, `requirements.txt`, `Dockerfile`, and README `/reel` section.
- [ ] **Step: local smoke (optional, mocked upload).** Build and run locally with dummy R2 unset; POST a small `/reel` payload with 2 public image URLs and no audio; assert `202`, and in logs the ffmpeg command runs to `out.mp4` (temporarily log/keep the file, or point `_r2()` at a local MinIO). Confirm the produced MP4 plays and is `1080×1350`. This is a manual/dev-loop check, not a committed vitest test.
- [ ] **Step: commit** — `feat(reel-service): /reel ffmpeg render endpoint on embed-service` (include Dockerfile + requirements).
- [ ] **Step: deploy to EC2** (mirror the embed-service deploy in `shaadi-deployment` memory + `embed-service/README.md`):
  1. `ssh -i jainam.pem ubuntu@ec2-52-87-170-196.compute-1.amazonaws.com`
  2. `git pull` (or `scp` the `embed-service/` delta), then `docker build -t shaadi-embed embed-service/`.
  3. `docker rm -f shaadi-embed` and re-run with the **added R2 env** plus the existing `EMBED_API_KEY`/`MODEL_BASE_URL`, `--restart always`, bound to `127.0.0.1:8000`, persistent `shaadi-models` volume.
  4. Add a Caddy route for `POST /reel` (the existing `/etc/caddy/Caddyfile` reverse-proxies `https://52-87-170-196.sslip.io` → `localhost:8000`; `/reel` is already covered by the same upstream — just confirm CORS/body-size limits allow the JSON dispatch). `sudo systemctl reload caddy`.
  5. Confirm the security group still allows 443.
- [ ] **Step: set Vercel prod env** — `REEL_FN_URL=https://52-87-170-196.sslip.io/reel` (add via `vercel env add REEL_FN_URL production`); `EMBED_API_KEY` already present. Redeploy the app.
- [ ] **Step: live verification** — from the app: create a reel from 2–3 photos → poll → a `<video>` plays; on the box `docker logs shaadi-embed` shows the render + a `200` from the callback; the R2 `reels/<jobId>.mp4` object exists and the admin Reels tab lists it.

---

## Risks / manual steps

- **EC2 deploy + SSH (Task 9)** is manual and mirrors the embed-service deploy documented in the `shaadi-deployment` memory (`ssh -i jainam.pem ubuntu@ec2-52-87-170-196...`, `docker build/run`, Caddy reload). The container now needs **R2 write credentials** (originals bucket) it did not have before — set them at `docker run` time. Rebuilding the image reinstalls InsightFace deps and re-adds `ffmpeg`; the model volume persists so no re-download.
- **Real song files** are deferred: `public/audio/placeholder-1.mp3` / `placeholder-2.mp3` are silent placeholders. The host drops real royalty-free files at the same paths (and extends `SONG_CATALOG`) later — no code change. Until then, reels with a placeholder song are effectively silent.
- **Render-service tests need mocking / are not in CI.** The ffmpeg endpoint isn't unit-tested in vitest (needs ffmpeg + network + R2). All app-side tests mock `dispatchReel` and R2, so CI stays green without the box. The `/reel` handler is verified by the Task 9 live smoke + curl only.
- **In-process vs. sibling container.** This plan extends `embed-service` in-process (matches the spec's primary recommendation and adds only `ffmpeg`+`boto3`); the `/reel` handler never triggers InsightFace model load (that's lazy on `/api/embed`). If reel renders start starving the face container's RAM (3.8 GB box), split `/reel` into a sibling container on the same box behind a distinct Caddy path — same bearer + Docker pattern.
- **Vercel function time on `POST /api/reel`.** The route only *dispatches* (render service returns `202` fast) and never blocks on ffmpeg, so it stays well under Hobby's 60s limit. The heavy work + the callback happen off-Vercel.
- **Callback reachability.** The EC2 box must reach the public Vercel origin for `/api/reel/callback`; `callbackUrl` is derived from the request's forwarded host/proto. If a deployment sits behind a rewrite that hides the public host, set an explicit origin env instead of deriving it.
- **xfade duration vs. total.** With `crossfade`, overlaps make the video slightly shorter than `totalSeconds`; `-shortest` trims audio to match. `kenburns`/`cut` hit `totalSeconds` exactly. Acceptable per spec ("~total").

## Self-review notes — spec §3.G requirement → task

| §3.G requirement | Task |
|---|---|
| Full-screen `ReelMaker.tsx`, opened from Results like collage | Task 7 |
| Reorderable photo strip (add/remove/reorder) | Task 7 |
| Length slider default 20s, max 60s; per-photo even split + nudge | Task 1 (`splitDurations`, bounds), Task 7 (slider/nudge) |
| Transition: crossfade / Ken Burns / cut | Task 1 (`TRANSITIONS`), Task 9 (ffmpeg filters) |
| Aspect 4:5 (default) or 9:16 | Task 1 (`aspectDimensions`), Task 7 (toggle), Task 9 (dims) |
| Bundled-song picker + waveform trim (start point, auto-fit) | Task 1 (`SONG_CATALOG`, `song.startSec`), Task 7 (trim UI) |
| Render progress; Save / Share / Add-to-album | Task 7 |
| `src/lib/reel.ts`: `SongCatalog`, `ReelSpec`, duration-split helper | Task 1 |
| Placeholder songs in `public/audio/` (real ones later) | Task 1 (assets), Risks |
| `POST /api/reel` validate (zod) + authorize + resolve previews + forward → `{jobId}` | Task 4 |
| `GET /api/reel?jobId=` → `{status, url?}` | Task 4 |
| `reel_jobs` table, migration `0004`, client polls | Task 2 (table), Task 6/7 (poll) |
| Bearer-auth proxy mirroring `EMBED_FN_URL`/`EMBED_API_KEY` | Task 3 (`reel-client.ts`, `REEL_FN_URL`) |
| Render service `/reel`: ffmpeg compose, down-res ~90%, `-ss/-t` audio, H.264 1080×1350/1920, upload R2 `/reels/`, return key/url | Task 9 |
| Frames from compressed R2 previews | Task 4 (`previewUrl`), Task 9 (normalize) |
| MP4 stored private → signed URL | Task 4 (`presignGet`), Task 9 (originals bucket) |
| New env `REEL_FN_URL` + R2 creds on the box + Docker/deploy delta | Task 3 (env), Task 9 (Dockerfile/deploy) |
| Rendered reels added to gallery + admin visibility, logged | Task 8 |
```
