import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { getPhotosForDownload, getSearchSession, getSettings, logDownload } from "@/lib/db";
import { getObjectStream } from "@/lib/r2";
import { checkRateLimit } from "@/lib/ratelimit";

// Node runtime: this route streams a ZIP via `archiver` over Node streams and
// reads originals from the AWS S3 client — neither runs on the edge runtime.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-cased file extension of an R2 key, or "jpg" as a safe default. */
function extOf(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
  return ext || "jpg";
}

// Fallback thresholds: above either bound we do not build the ZIP inline. The
// archive streams (constant memory), so the real risk is the function's request
// time limit being hit mid-download on a slow client — which would truncate the
// ZIP. These bounds cover essentially every real guest album in one download;
// only pathologically large sets fall back to the "download individually" hint.
const MAX_ZIP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB
const MAX_ZIP_FILES = 1000;

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
 * GET /api/download-zip?sessionId= — download every matched original for a
 * search session as one streamed ZIP.
 *
 * Looks up the session's persisted `matched_ids`, resolves the active photos,
 * and — unless the set is too large — streams a ZIP whose entries are the
 * originals pulled straight from R2. Oversized sets return a 200 JSON
 * `{ mode: "prepare" }` signal instead of an inline archive.
 */
export async function GET(req: Request): Promise<Response> {
  // Maintenance kill switch: refuse downloads.
  if ((await getSettings()).killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  // Per-IP sliding-window rate limit. A null IP is unattributable — fail closed
  // for this bandwidth-heavy endpoint so an IP-less caller can't bypass it.
  const ip = clientIp(req);
  if (!ip || !(await checkRateLimit(ip))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return Response.json({ error: "invalid_session_id" }, { status: 400 });
  }

  const session = await getSearchSession(sessionId);
  if (!session || !session.matched_ids || session.matched_ids.length === 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const photos = await getPhotosForDownload(session.matched_ids);
  if (photos.length === 0) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Oversized sets fall back to the async prepare flow.
  const totalBytes = photos.reduce((sum, p) => sum + (p.bytes ?? 0), 0);
  if (totalBytes > MAX_ZIP_BYTES || photos.length > MAX_ZIP_FILES) {
    return Response.json(
      {
        mode: "prepare",
        message:
          "This album is too large to zip in one go. Open any photo and use “Download original” to save them individually.",
      },
      { status: 200 },
    );
  }

  // Build the archive: append each original as an entry, then finalize. Errors
  // (e.g. a source stream failing mid-transfer) destroy the archive so the
  // response stream aborts cleanly instead of hanging half-written.
  const archive = new ZipArchive();
  archive.on("error", (err) => {
    archive.destroy(err);
  });

  // B8: a single missing/broken original must not 500 the whole ZIP. Fetch and
  // append each entry inside try/catch — skip-and-log a failed object, continue
  // with the rest — and count how many actually made it in.
  let appended = 0;
  for (const photo of photos) {
    try {
      const body = await getObjectStream(photo.original_key);
      archive.append(body, { name: `${photo.id}.${extOf(photo.original_key)}` });
      appended++;
    } catch (err) {
      console.error(`download-zip: skipping ${photo.id} (${photo.original_key}):`, err);
    }
  }

  // Fire-and-forget: finalize resolves once all entries are queued; the response
  // stream drains the archive as the client reads it.
  void archive.finalize();

  await logDownload({ kind: "zip", sessionId, count: appended, ip });

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="shaadi-photos.zip"',
    },
  });
}
