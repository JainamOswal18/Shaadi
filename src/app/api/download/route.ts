import { Readable } from "node:stream";
import { getPhotoOriginal, getSettings, logDownload } from "@/lib/db";
import { getObjectStream } from "@/lib/r2";

// Node runtime: streaming from the AWS S3 client + the postgres driver both
// require Node — neither runs on the edge runtime.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

/** Lower-cased file extension of an R2 key, or "jpg" as a safe default. */
function extOf(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  return ext || "jpg";
}

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
 * GET /api/download?photoId= — download a single photo at FULL/original quality.
 *
 * Streams the untouched original straight from private R2 THROUGH this function
 * (same-origin) rather than 302-redirecting to R2. Same-origin matters: it lets
 * the client read the bytes with a plain fetch (no cross-origin CORS), which is
 * what powers the in-app loading state and the "save to gallery" share sheet on
 * mobile. `Content-Length` is set when known so the browser can show progress.
 * Logs a `single` download event for audit.
 */
export async function GET(req: Request): Promise<Response> {
  // Maintenance kill switch: refuse downloads.
  if ((await getSettings()).killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  const photoId = new URL(req.url).searchParams.get("photoId");
  if (!photoId || !UUID_RE.test(photoId)) {
    return Response.json({ error: "invalid_photo_id" }, { status: 400 });
  }

  const photo = await getPhotoOriginal(photoId);
  if (!photo) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const ext = extOf(photo.original_key);
  const stream = await getObjectStream(photo.original_key);

  await logDownload({ kind: "single", photoId, ip: clientIp(req) });

  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename="${photoId}.${ext}"`,
    "Cache-Control": "private, max-age=3600",
  };
  if (photo.bytes && photo.bytes > 0) headers["Content-Length"] = String(photo.bytes);

  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { headers });
}
