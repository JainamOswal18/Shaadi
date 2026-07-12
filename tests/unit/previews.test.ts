// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makePreviews, videoPoster } from "@/lib/previews";

const execFileAsync = promisify(execFile);

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  // Noise, not a flat color: a solid-color JPEG/WebP compresses to a few
  // hundred bytes regardless of encoder settings, which would make the
  // "<30KB thumb" assertion meaningless. Random noise forces the encoder to
  // actually work, so a passing size assertion means something.
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
  return sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

describe("makePreviews", () => {
  it("produces a thumb <=350px longest edge and <30KB", async () => {
    const input = await makeTestImage(4000, 3000);
    const { thumb } = await makePreviews(input);
    const meta = await sharp(thumb).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(350);
    expect(thumb.byteLength).toBeLessThan(30_000);
    expect(meta.format).toBe("webp");
  });

  it("produces medium webp/avif previews <=1280px longest edge", async () => {
    const input = await makeTestImage(4000, 3000);
    const { mediumWebp, mediumAvif } = await makePreviews(input);

    const webpMeta = await sharp(mediumWebp).metadata();
    expect(Math.max(webpMeta.width ?? 0, webpMeta.height ?? 0)).toBeLessThanOrEqual(1280);
    expect(webpMeta.format).toBe("webp");

    const avifMeta = await sharp(mediumAvif).metadata();
    expect(Math.max(avifMeta.width ?? 0, avifMeta.height ?? 0)).toBeLessThanOrEqual(1280);
    expect(["heif", "avif"]).toContain(avifMeta.format);
  });

  it("returns the ORIGINAL image dimensions, not the resized dimensions", async () => {
    const input = await makeTestImage(4000, 3000);
    const { width, height } = await makePreviews(input);
    expect(width).toBe(4000);
    expect(height).toBe(3000);
  });

  it("honors EXIF orientation: reports oriented (displayed) width/height", async () => {
    // orientation 6 = rotate 90° CW to display; stored raster is 100x60 but
    // the displayed/oriented image is 60x100.
    const input = await sharp({
      create: { width: 100, height: 60, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const { width, height, thumb } = await makePreviews(input);
    expect(width).toBe(60);
    expect(height).toBe(100);

    // The generated thumb pixels should also reflect the rotation (portrait).
    const thumbMeta = await sharp(thumb).metadata();
    expect(thumbMeta.width ?? 0).toBeLessThanOrEqual(thumbMeta.height ?? 0);
  });
});

describe("videoPoster", () => {
  it("is a function with the expected shape", () => {
    expect(typeof videoPoster).toBe("function");
  });

  // Generates a real 1s ffmpeg testsrc clip and extracts a WebP poster from
  // it. Skipped only if ffmpeg itself is unavailable in the environment —
  // this repo has ffmpeg on PATH (confirmed via `which ffmpeg`), so this
  // runs for real rather than faking a pass.
  it("extracts a WebP poster frame from a generated test clip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shaadi-poster-test-"));
    const clipPath = join(dir, "clip.mp4");
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=1:size=320x240:rate=10",
        "-pix_fmt",
        "yuv420p",
        clipPath,
      ]);

      const poster = await videoPoster(clipPath);
      expect(poster).toBeInstanceOf(Buffer);
      expect(poster.byteLength).toBeGreaterThan(0);

      const meta = await sharp(poster).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(640);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
