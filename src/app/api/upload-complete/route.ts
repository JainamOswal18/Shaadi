import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  getSettings,
  insertMedia,
  insertPhotoWithFaces,
  logUpload,
  sql,
} from "@/lib/db";
import { embedImage } from "@/lib/embed-client";
import { loadEnv } from "@/lib/env";
import { makePreviews, videoPoster } from "@/lib/previews";
import { getObjectStream, s3Client } from "@/lib/r2";

// Node runtime: this route reads streams from R2, runs sharp/ffmpeg, hashes with
// node:crypto, and writes to Postgres — none of which run on the edge runtime.
export const runtime = "nodejs";

// Previews are content-addressed and never overwritten, so cache them forever.
const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

// Extension -> media kind. Anything not listed is skipped.
const PHOTO_EXTS = new Set(["jpg", "jpeg", "png", "heic", "webp"]);
const VIDEO_EXTS = new Set(["mp4", "mov"]);

// Hard cap on keys per finalize call: a batch can't exceed the combined photo +
// video quota, and this bounds the work a single request can trigger.
const MAX_KEYS = 25;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  guestName: z.string().default(""),
  keys: z.array(z.string().min(1)),
});

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

function extOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? "" : key.slice(dot + 1).toLowerCase();
}

function stemOf(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Upload a preview/poster object to the previews bucket, cached immutably. */
async function putPreview(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: loadEnv().R2_BUCKET_PREVIEWS,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: CACHE_CONTROL_IMMUTABLE,
    }),
  );
}

/** True if a photo or media row already exists for this content hash. */
async function alreadyProcessed(hash: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    select 1 as one from photos where content_hash = ${hash}
    union all
    select 1 as one from media where content_hash = ${hash}
    limit 1`;
  return rows.length > 0;
}

/**
 * POST /api/upload-complete — finalize a batch of guest uploads.
 *
 * For each original key already PUT to R2 by the client: fetch the bytes, and
 *  - photos -> generate previews (thumb + medium webp/avif) into the previews
 *    bucket, embed faces, and insert a `photos` row + its `faces`;
 *  - videos -> extract a poster frame into the previews bucket and insert a
 *    `media` row.
 * Rows are inserted `active` (auto-published). Duplicates (same content hash,
 * already indexed by ingest or an earlier upload) are skipped. The batch is
 * audit-logged with the processed photo/video counts.
 */
export async function POST(req: Request): Promise<Response> {
  // Maintenance kill switch: refuse to finalize uploads.
  if ((await getSettings()).killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { sessionId, keys } = parsed;

  // B1: bound the batch size and confine every key to this session's own upload
  // prefix, so a caller can't point finalize at arbitrary R2 objects (e.g.
  // someone else's uploads, or originals from ingest) to index or dedupe them.
  if (keys.length > MAX_KEYS) {
    return Response.json({ error: "too_many_keys" }, { status: 400 });
  }
  const prefix = `uploads/${sessionId}/`;
  if (!keys.every((k) => k.startsWith(prefix))) {
    return Response.json({ error: "invalid_key" }, { status: 400 });
  }

  const guestName = parsed.guestName.trim() || null;
  const ip = clientIp(req);

  let photos = 0;
  let videos = 0;

  for (const key of keys) {
    const ext = extOf(key);
    const isPhoto = PHOTO_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isPhoto && !isVideo) continue; // unknown type — skip.

    try {
      const stem = stemOf(key);

      if (isPhoto) {
        // Photos are small (<=25MB) and need to be fully in memory for sharp +
        // embedding, so buffering is fine here.
        const bytes = await streamToBuffer(await getObjectStream(key));
        const contentHash = sha256Hex(bytes);

        // Dedupe: never index the same content twice (ingest or prior upload).
        if (await alreadyProcessed(contentHash)) continue;

        const preview = await makePreviews(bytes);
        const thumbKey = `thumb/${stem}.webp`;
        const previewKey = `medium/${stem}.webp`;
        const avifKey = `medium/${stem}.avif`;

        await Promise.all([
          putPreview(thumbKey, preview.thumb, "image/webp"),
          putPreview(previewKey, preview.mediumWebp, "image/webp"),
          putPreview(avifKey, preview.mediumAvif, "image/avif"),
        ]);

        const embed = await embedImage(bytes);
        // B1/atomicity: photo row + its faces are inserted in one transaction so
        // a faces failure can't orphan a photo row.
        await insertPhotoWithFaces(
          {
            source: "guest_upload",
            contentHash,
            originalKey: key,
            previewKey,
            thumbKey,
            width: preview.width,
            height: preview.height,
            bytes: bytes.byteLength,
            uploadedBy: guestName,
            uploadSession: sessionId,
          },
          embed.faces.map((f) => ({
            embedding: f.embedding,
            bbox: f.bbox,
            detScore: f.det_score,
          })),
        );
        photos++;
      } else {
        // B9: videos can be up to 300MB — never buffer the whole object in
        // memory (OOM risk on serverless). Stream the R2 object straight to a
        // temp file, hashing as bytes flow through so we still get the content
        // hash for dedupe without a second pass.
        const dir = await mkdtemp(join(tmpdir(), "shaadi-upload-"));
        const tmpFile = join(dir, `${stem}.${ext}`);
        try {
          const hash = createHash("sha256");
          const source = await getObjectStream(key);
          await pipeline(
            source,
            async function* (chunks) {
              for await (const chunk of chunks) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                hash.update(buf);
                yield buf;
              }
            },
            createWriteStream(tmpFile),
          );
          const contentHash = hash.digest("hex");

          // Dedupe: never index the same content twice (ingest or prior upload).
          if (await alreadyProcessed(contentHash)) continue;

          const { size } = await stat(tmpFile);

          let posterKey: string | null = null;
          try {
            const poster = await videoPoster(tmpFile);
            posterKey = `poster/${stem}.webp`;
            await putPreview(posterKey, poster, "image/webp");
          } catch (err) {
            // A poster failure must not lose the video: store it without one.
            console.error(`upload-complete: poster failed for ${key}:`, err);
            posterKey = null;
          }

          await insertMedia({
            source: "guest_upload",
            contentHash,
            originalKey: key,
            posterKey,
            bytes: size,
            uploadedBy: guestName,
            uploadSession: sessionId,
          });
          videos++;
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    } catch (err) {
      // One bad object shouldn't fail the whole batch; skip and continue.
      console.error(`upload-complete: failed to process ${key}:`, err);
    }
  }

  // Audit-log the batch under this session with the processed counts.
  await logUpload({
    uploadSession: sessionId,
    guestName,
    ip,
    userAgent: req.headers.get("user-agent"),
    photoCount: photos,
    videoCount: videos,
  });

  return Response.json({ processed: photos + videos, photos, videos }, { status: 200 });
}
