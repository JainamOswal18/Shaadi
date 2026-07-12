import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getIpQuota, getSessionQuota, getSettings } from "@/lib/db";
import { presignPut } from "@/lib/r2";
import { checkRateLimit } from "@/lib/ratelimit";
import type { UploadUrlResponse } from "@/lib/types";

// Node runtime: this route uses `node:crypto`, the AWS S3 client (presigning),
// and the postgres driver, none of which run on the edge runtime.
export const runtime = "nodejs";

// Global caps. Enforced primarily per client IP (the real abuse guard, since
// sessionId is client-chosen and rotatable) and secondarily per session.
const PHOTO_LIMIT = 20;
const VIDEO_LIMIT = 5;
const PHOTO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const VIDEO_MAX_BYTES = 300 * 1024 * 1024; // 300 MB

// Allowlisted content types -> canonical file extension for the object key.
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
};
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const FileSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  size: z.number().int().nonnegative(),
  kind: z.enum(["photo", "video"]),
});

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  guestName: z.string().default(""),
  files: z.array(FileSchema),
});

/**
 * Resolve the originating client IP. Behind Vercel/Cloudflare the real client is
 * the first hop in `x-forwarded-for`; `x-real-ip` is the single-value fallback.
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * POST /api/upload-url — issue presigned PUT URLs for a batch of guest uploads.
 *
 * Enforces per-session quotas (20 photos + 5 videos) and per-file type/size
 * caps. Files whose type isn't allowlisted or whose size exceeds the cap are
 * silently dropped; once a kind's remaining quota is exhausted, any further
 * files of that kind are truncated. The response's `remaining` counts and the
 * shorter-than-requested `grants` array signal the truncation to the client.
 */
export async function POST(req: Request): Promise<Response> {
  // Maintenance kill switch: refuse to issue new upload URLs.
  if ((await getSettings()).killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  // Per-IP sliding-window rate limit. A null IP is unattributable — fail closed
  // for this write-side endpoint so an IP-less caller can't bypass the limiter.
  const ip = clientIp(req);
  if (!ip || !(await checkRateLimit(ip))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { sessionId, files } = parsed;

  // Remaining quota is the tighter of the per-IP rolling total (the real guard,
  // resistant to sessionId rotation) and the per-session total (secondary).
  const [ipUsed, sessionUsed] = await Promise.all([
    getIpQuota(ip),
    getSessionQuota(sessionId),
  ]);
  let photosLeft = Math.min(
    Math.max(0, PHOTO_LIMIT - ipUsed.photos),
    Math.max(0, PHOTO_LIMIT - sessionUsed.photos),
  );
  let videosLeft = Math.min(
    Math.max(0, VIDEO_LIMIT - ipUsed.videos),
    Math.max(0, VIDEO_LIMIT - sessionUsed.videos),
  );

  const grants: UploadUrlResponse["grants"] = [];

  for (const file of files) {
    const ext =
      file.kind === "photo" ? PHOTO_TYPES[file.type] : VIDEO_TYPES[file.type];
    // Drop files with a non-allowlisted type for their declared kind.
    if (!ext) continue;

    const maxBytes = file.kind === "photo" ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES;
    if (file.size > maxBytes) continue; // over the per-file cap — drop it.

    // Truncate once this kind's remaining quota is exhausted.
    if (file.kind === "photo") {
      if (photosLeft <= 0) continue;
      photosLeft--;
    } else {
      if (videosLeft <= 0) continue;
      videosLeft--;
    }

    const key = `uploads/${sessionId}/${randomUUID()}.${ext}`;
    const putUrl = await presignPut(key, file.type);
    grants.push({ name: file.name, key, putUrl });
  }

  const body: UploadUrlResponse = {
    grants,
    remaining: { photos: photosLeft, videos: videosLeft },
  };
  return Response.json(body, { status: 200 });
}
