import { getPhotoOriginal, getSettings, logDownload } from "@/lib/db";
import { presignGet } from "@/lib/r2";

// Node runtime: presigning uses the AWS S3 client and the route reads from the
// postgres driver, neither of which runs on the edge runtime.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * GET /api/download?photoId= — download a single original photo.
 *
 * Resolves the photo's private original key, mints a short-lived presigned URL
 * with a forced attachment filename, and 302-redirects the browser to it so the
 * bytes stream straight from R2 (never through this function). Logs a `single`
 * download event for audit.
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

  // Preserve the original file's real extension in the forced download name.
  const signed = await presignGet(photo.original_key, {
    download: true,
    filename: `${photoId}.${extOf(photo.original_key)}`,
  });

  await logDownload({ kind: "single", photoId, ip: clientIp(req) });

  return Response.redirect(signed, 302);
}
