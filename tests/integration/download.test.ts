// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the single + ZIP download routes end-to-end against an
// isolated `shaadi_test_download` schema (real Postgres DDL). The only external
// side effect stubbed is R2 object retrieval (aws-sdk-client-mock): each
// GetObjectCommand resolves a fresh small readable "JPEG" body. Presigning does
// not hit the mock (getSignedUrl signs locally without sending a command).

// Distinct schema so parallel Vitest workers never contend on create/drop.
const TEST_SCHEMA = "shaadi_test_download";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

// Patch the S3 client class before r2.ts constructs its instance (on import).
const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let updateSettings: typeof import("@/lib/db").updateSettings;
let downloadGET: typeof import("@/app/api/download/route").GET;
let zipGET: typeof import("@/app/api/download-zip/route").GET;

// A client IP is required now that the download-zip route rate-limits (and fails
// closed on a null IP). Requests carry a forwarded-for so they are attributable.
const IP_HEADERS = { "x-forwarded-for": "7.7.7.7, 10.0.0.1" };

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

// A real 4000×3000 JPEG so the routes exercise actual sharp re-encoding
// (compressForDownload) rather than the undecodable-input fallback path.
let realJpeg: Buffer;
let photo1: { id: string; original_key: string };
let photo2: { id: string; original_key: string };
let sessionId: string;

/**
 * Parse a (non-zip64) ZIP archive's central directory and return entry names.
 * Reads names straight from the central directory headers — no decompression —
 * which is enough to assert the archive's contents.
 */
function listZipEntries(buf: Buffer): string[] {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("no End Of Central Directory record found");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory header");
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.toString("utf8", offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  insertPhoto = db.insertPhoto;
  updateSettings = db.updateSettings;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Import the routes last, so they bind to the test-schema db client.
  downloadGET = (await import("@/app/api/download/route")).GET;
  zipGET = (await import("@/app/api/download-zip/route")).GET;

  // A decodable original, larger than the download edge cap so re-encoding both
  // downsizes and re-compresses it.
  realJpeg = await sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 120, g: 80, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  // Seed two active photos + a search session whose matched_ids reference them.
  const p1 = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/one.jpg",
    previewKey: "preview/one.jpg",
    thumbKey: "thumb/one.jpg",
    bytes: 1024,
  });
  const p2 = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/two.jpg",
    previewKey: "preview/two.jpg",
    thumbKey: "thumb/two.jpg",
    bytes: 2048,
  });
  photo1 = { id: p1.id, original_key: "orig/one.jpg" };
  photo2 = { id: p2.id, original_key: "orig/two.jpg" };

  sessionId = randomUUID();
  await sql`
    insert into search_sessions (id, guest_name, match_count, matched_ids)
    values (${sessionId}, 'Guest', 2, ${[photo1.id, photo2.id]}::uuid[])`;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

beforeEach(() => {
  s3mock.reset();
  // Every GetObjectCommand yields a fresh readable copy of a real JPEG.
  s3mock.on(GetObjectCommand).callsFake(() => ({
    Body: Readable.from(Buffer.from(realJpeg)),
  }));
});

describe("download routes (integration, isolated schema)", () => {
  it("GET /api/download?photoId= streams a compressed JPEG of the original", async () => {
    const req = new Request(`http://localhost/api/download?photoId=${photo1.id}`, {
      headers: IP_HEADERS,
    });
    const res = await downloadGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toContain(`${photo1.id}.jpg`);

    // Body is a valid JPEG, re-encoded and downsized to the 3072px edge cap.
    const out = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(3072);
    expect(out.length).toBeLessThan(realJpeg.length); // smaller than the 4000×3000 original

    const rows = await sql`select kind, photo_id from download_events where kind = 'single'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].photo_id).toBe(photo1.id);
  });

  it("GET /api/download falls back to a 302 presigned original when it can't decode", async () => {
    // An undecodable original (not a real image) must not fail the download —
    // the route falls back to a presigned redirect to the untouched file.
    s3mock.reset();
    s3mock.on(GetObjectCommand).callsFake(() => ({
      Body: Readable.from(Buffer.from("not-an-image")),
    }));
    const req = new Request(`http://localhost/api/download?photoId=${photo1.id}`, {
      headers: IP_HEADERS,
    });
    const res = await downloadGET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain(photo1.original_key);
  });

  it("GET /api/download for an unknown photo returns 404", async () => {
    const req = new Request(`http://localhost/api/download?photoId=${randomUUID()}`, {
      headers: IP_HEADERS,
    });
    const res = await downloadGET(req);
    expect(res.status).toBe(404);
  });

  it("GET /api/download-zip?sessionId= streams a zip of the matched originals", async () => {
    const req = new Request(`http://localhost/api/download-zip?sessionId=${sessionId}`, {
      headers: IP_HEADERS,
    });
    const res = await zipGET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("shaadi-photos.zip");

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = listZipEntries(buf).sort();
    // Entry names now carry the original's real extension (.jpg here).
    expect(entries).toEqual([`${photo1.id}.jpg`, `${photo2.id}.jpg`].sort());

    const rows = await sql`select count(*)::int as c from download_events where kind = 'zip'`;
    expect(rows[0].c).toBe(1);
  });

  it("GET /api/download-zip?start=&count= zips only the requested part slice", async () => {
    // Part 1: first matched id only.
    const p1 = await zipGET(
      new Request(`http://localhost/api/download-zip?sessionId=${sessionId}&start=0&count=1`, {
        headers: IP_HEADERS,
      }),
    );
    expect(p1.status).toBe(200);
    expect(p1.headers.get("content-type")).toBe("application/zip");
    // Filename carries the 1-based photo range for this part.
    expect(p1.headers.get("content-disposition")).toContain("shaadi-photos_1-1.zip");
    expect(listZipEntries(Buffer.from(await p1.arrayBuffer()))).toEqual([`${photo1.id}.jpg`]);

    // Part 2: second matched id only (the slice offset by `start`).
    const p2 = await zipGET(
      new Request(`http://localhost/api/download-zip?sessionId=${sessionId}&start=1&count=1`, {
        headers: IP_HEADERS,
      }),
    );
    expect(p2.status).toBe(200);
    expect(listZipEntries(Buffer.from(await p2.arrayBuffer()))).toEqual([`${photo2.id}.jpg`]);
  });

  it("GET /api/download-zip for an unknown session returns 404", async () => {
    const req = new Request(`http://localhost/api/download-zip?sessionId=${randomUUID()}`, {
      headers: IP_HEADERS,
    });
    const res = await zipGET(req);
    expect(res.status).toBe(404);
  });

  it("B8: download-zip continues (200) when one original 404s in R2", async () => {
    // Make the second photo's original fail to fetch; the first still succeeds.
    s3mock.reset();
    s3mock.on(GetObjectCommand).callsFake((input: { Key?: string }) => {
      if (input.Key === photo2.original_key) {
        throw new Error("NoSuchKey: simulated missing original");
      }
      return { Body: Readable.from(Buffer.from("fake-jpeg-bytes")) };
    });

    const req = new Request(`http://localhost/api/download-zip?sessionId=${sessionId}`, {
      headers: IP_HEADERS,
    });
    const res = await zipGET(req);
    expect(res.status).toBe(200);

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = listZipEntries(buf);
    // Only the healthy entry made it into the archive; the missing one was skipped.
    expect(entries).toEqual([`${photo1.id}.jpg`]);

    // The audit count reflects only the entries actually appended.
    const rows = await sql`select count from download_events where kind = 'zip' order by created_at desc limit 1`;
    expect(Number(rows[0].count)).toBe(1);
  });

  it("B4b: download + download-zip return 503 {maintenance} when the kill switch is on", async () => {
    await updateSettings({ killSwitch: true });
    try {
      const dl = await downloadGET(
        new Request(`http://localhost/api/download?photoId=${photo1.id}`, { headers: IP_HEADERS }),
      );
      expect(dl.status).toBe(503);
      expect(await dl.json()).toEqual({ error: "maintenance" });

      const zip = await zipGET(
        new Request(`http://localhost/api/download-zip?sessionId=${sessionId}`, {
          headers: IP_HEADERS,
        }),
      );
      expect(zip.status).toBe(503);
      expect(await zip.json()).toEqual({ error: "maintenance" });
    } finally {
      await updateSettings({ killSwitch: false });
    }
  });
});
