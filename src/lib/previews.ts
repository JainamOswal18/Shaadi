import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

// Vercel's serverless runtime has no `ffmpeg` on PATH. `ffmpeg-static` ships a
// prebuilt binary and resolves its absolute path; prefer it, falling back to a
// PATH `ffmpeg` (e.g. local dev / CI where the static download was skipped).
const FFMPEG_BIN: string = ffmpegStatic ?? "ffmpeg";

const THUMB_EDGE = 350;
const THUMB_QUALITY = 78;
const MEDIUM_EDGE = 1280;
const MEDIUM_WEBP_QUALITY = 80;
const POSTER_WIDTH = 640;
const POSTER_QUALITY = 80;

export interface PreviewSet {
  thumb: Buffer;
  mediumWebp: Buffer;
  mediumAvif: Buffer;
  width: number;
  height: number;
}

/**
 * Generate a thumbnail (WebP) and medium-size previews (WebP + AVIF) for an
 * image, honoring EXIF orientation. Returns the ORIGINAL image dimensions
 * (not the resized dimensions of any of the generated previews).
 */
export async function makePreviews(input: Buffer): Promise<PreviewSet> {
  // sharp's metadata() always reports the raw stored width/height + EXIF
  // orientation, regardless of a queued .rotate() call (rotation only takes
  // effect when pixels are actually processed, e.g. via toBuffer()).
  const metadata = await sharp(input).metadata();
  const { width, height } = orientedDimensions(metadata);
  if (width === undefined || height === undefined) {
    throw new Error("makePreviews: could not read image dimensions");
  }

  const [thumb, mediumWebp, mediumAvif] = await Promise.all([
    sharp(input)
      .rotate()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer(),
    sharp(input)
      .rotate()
      .resize({
        width: MEDIUM_EDGE,
        height: MEDIUM_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MEDIUM_WEBP_QUALITY })
      .toBuffer(),
    sharp(input)
      .rotate()
      .resize({ width: MEDIUM_EDGE, height: MEDIUM_EDGE, fit: "inside", withoutEnlargement: true })
      .avif()
      .toBuffer(),
  ]);

  return { thumb, mediumWebp, mediumAvif, width, height };
}

type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;

// sharp's metadata() reports width/height as stored in the file (pre-rotation).
// When EXIF orientation swaps axes (values 5-8), the *displayed*/oriented
// image has width and height swapped relative to the raw values. Since
// makePreviews() always calls .rotate() first, callers expect the dimensions
// of the oriented (displayed) image.
function orientedDimensions(metadata: SharpMetadata): {
  width: number | undefined;
  height: number | undefined;
} {
  const { width, height, orientation } = metadata;
  if (width === undefined || height === undefined) return { width, height };
  const swapped = orientation !== undefined && orientation >= 5 && orientation <= 8;
  return swapped ? { width: height, height: width } : { width, height };
}

/**
 * Extract a poster frame from a video file via ffmpeg, seeking ~10% into
 * the clip and scaling to ~640px wide (aspect preserved), then encode it as
 * WebP.
 *
 * ffmpeg extracts the frame as PNG rather than encoding WebP directly:
 * not every ffmpeg build includes a libwebp encoder (confirmed missing from
 * the ffmpeg on this machine's PATH — `-c:v webp` fails with "Encoder not
 * found"), while PNG output is universally supported. Sharp (already a
 * dependency, and libwebp-backed) then does the WebP encode, which also
 * keeps quality/settings consistent with the image previews above.
 */
export async function videoPoster(path: string): Promise<Buffer> {
  const duration = await probeDuration(path);
  const seek = Math.max(0, duration * 0.1);

  const dir = await mkdtemp(join(tmpdir(), "shaadi-poster-"));
  const framePath = join(dir, "frame.png");
  try {
    await execFileAsync(FFMPEG_BIN, [
      "-y",
      "-ss",
      seek.toFixed(3),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      `scale=${POSTER_WIDTH}:-2`,
      framePath,
    ]).catch((err) => {
      throw new Error(`videoPoster: ffmpeg failed to extract a frame from ${path}: ${err.message}`);
    });
    const frame = await readFile(framePath);
    return await sharp(frame).webp({ quality: POSTER_QUALITY }).toBuffer();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // ffprobe unavailable or the file has no readable duration (e.g. a
    // pathological/short clip) — fall back to seeking to the start.
    return 0;
  }
}
