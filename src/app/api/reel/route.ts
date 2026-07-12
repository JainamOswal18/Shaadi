import { z } from "zod";
import {
  getPhotosByIds,
  getReelJob,
  getSettings,
  insertReelJob,
  setReelJobStatus,
} from "@/lib/db";
import { previewUrl, presignGet } from "@/lib/r2";
import { checkRateLimit } from "@/lib/ratelimit";
import { aspectDimensions, ReelSpecSchema, songById, splitDurations } from "@/lib/reel";
import { dispatchReel } from "@/lib/reel-client";
import type { CreateReelResponse, ReelStatusResponse } from "@/lib/types";

// Node runtime: this route uses the postgres driver, the AWS S3 presigner, and
// the reel-client fetch proxy, none of which run on the edge runtime.
export const runtime = "nodejs";

const REEL_URL_EXPIRY_SECONDS = 3600; // 1h signed playback/download URL

/**
 * Resolve the originating client IP. Behind Vercel/Cloudflare the real client is
 * the first hop in `x-forwarded-for`; `x-real-ip` is the single-value fallback.
 */
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

/** App origin as seen by an external caller — used to build public audio URLs
 *  and the render callback URL the EC2 box will hit. */
function appOrigin(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

/**
 * POST /api/reel — validate a ReelSpec, resolve photo preview URLs, insert a
 * `queued` reel_jobs row, and dispatch the render to the EC2 embed-service
 * (fire-and-forget: the render POST returns 202 immediately). Returns
 * `{ jobId }` for the client to poll via GET.
 */
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
      jobId,
      aspect: spec.aspect,
      width,
      height,
      totalSeconds: spec.totalSeconds,
      transition: spec.transition,
      frames,
      audio: { url: audioUrl, startSec: spec.song.startSec },
      outputKey,
      callbackUrl: `${appOrigin(req)}/api/reel/callback`,
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

/** GET /api/reel?jobId= — poll a reel job's status; returns a short-lived
 *  signed playback URL once the render is done. */
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
