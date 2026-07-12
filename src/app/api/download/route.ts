import { getPhotoOriginal, getSettings, logDownload } from "@/lib/db";
import { compressForDownload } from "@/lib/previews";
import { getObjectBuffer, presignGet } from "@/lib/r2";

// Node runtime: sharp re-encoding, the AWS S3 client, and the postgres driver
// all require Node — none run on the edge runtime.
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
 * GET /api/download?photoId= — download a single photo.
 *
 * Serves a re-encoded ("Balanced") copy of the original: full-quality-looking
 * but much smaller. The original is fetched from private R2, compressed with
 * sharp, and streamed back as an attachment JPEG. If the original can't be
 * decoded (e.g. a HEIC this runtime's sharp can't read), we fall back to a
 * presigned 302 redirect to the untouched original so the download never fails.
 * Logs a `single` download event for audit either way.
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

  await logDownload({ kind: "single", photoId, ip: clientIp(req) });

  try {
    const original = await getObjectBuffer(photo.original_key);
    const compressed = await compressForDownload(original);
    return new Response(compressed as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${photoId}.jpg"`,
      },
    });
  } catch (err) {
    // Undecodable original (or a transient fetch failure): fall back to the
    // untouched original via a presigned redirect rather than erroring.
    console.error(`download: compression fell back to original for ${photoId}:`, err);
    const signed = await presignGet(photo.original_key, {
      download: true,
      filename: `${photoId}.${extOf(photo.original_key)}`,
    });
    return Response.redirect(signed, 302);
  }
}
