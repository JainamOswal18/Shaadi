import { verifyAdmin } from "@/lib/auth";
import { getMediaKeys, getPhotoKeys, softDeleteMedia, softDeletePhoto } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { deleteObject } from "@/lib/r2";

// Node runtime: talks to the postgres driver, the S3/R2 client, and verifies the
// JWT via jose — none of which run on the edge runtime.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/delete — body `{ photoId }`. Requires a valid admin cookie
 * (401 otherwise). The admin gallery (`GET /api/admin/media`) mixes photos and
 * videos behind one id space, so `photoId` is looked up against `photos`
 * first and, if not found, against `media` (videos) — whichever matches is
 * purged from R2 and soft-deleted (status = 'deleted') so it drops out of
 * search/download/the gallery immediately.
 */
export async function POST(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let photoId: unknown;
  try {
    photoId = (await req.json())?.photoId;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof photoId !== "string" || !UUID_RE.test(photoId)) {
    return Response.json({ error: "invalid_photo_id" }, { status: 400 });
  }

  const env = loadEnv();

  const photoKeys = await getPhotoKeys(photoId);
  if (photoKeys) {
    // The medium AVIF sibling isn't stored on the row; it's the webp preview
    // key with the extension swapped (e.g. medium/<id>.webp -> medium/<id>.avif).
    const avifKey = photoKeys.preview_key.replace(/\.webp$/i, ".avif");

    await Promise.all([
      deleteObject(photoKeys.original_key, env.R2_BUCKET_ORIGINALS),
      deleteObject(photoKeys.thumb_key, env.R2_BUCKET_PREVIEWS),
      deleteObject(photoKeys.preview_key, env.R2_BUCKET_PREVIEWS),
      deleteObject(avifKey, env.R2_BUCKET_PREVIEWS),
    ]);

    await softDeletePhoto(photoId);
    return Response.json({ ok: true }, { status: 200 });
  }

  const mediaKeys = await getMediaKeys(photoId);
  if (mediaKeys) {
    await Promise.all([
      deleteObject(mediaKeys.original_key, env.R2_BUCKET_ORIGINALS),
      ...(mediaKeys.poster_key
        ? [deleteObject(mediaKeys.poster_key, env.R2_BUCKET_PREVIEWS)]
        : []),
    ]);

    await softDeleteMedia(photoId);
    return Response.json({ ok: true }, { status: 200 });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}
