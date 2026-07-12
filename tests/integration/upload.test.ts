// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the guest upload endpoints end-to-end against an isolated
// `shaadi_test_upload` schema (real Postgres DDL). The only external side effects
// stubbed are the face-embedding HTTP call (mocked module) and R2 object storage
// (aws-sdk-client-mock). Nothing touches production data or real object storage.

// Distinct schema so parallel Vitest workers never contend on create/drop.
const TEST_SCHEMA = "shaadi_test_upload";
const DIM = 512;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function unitVector(dim: number, hot: number): number[] {
  const v = new Array(dim).fill(0);
  v[hot] = 1;
  return v;
}

// Mock only the embedding HTTP client; keep everything else real.
vi.mock("@/lib/embed-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embed-client")>();
  return { ...actual, embedImage: vi.fn() };
});

// Patch the S3 client class before r2.ts constructs its instance (on import).
const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let uploadUrlPOST: typeof import("@/app/api/upload-url/route").POST;
let uploadCompletePOST: typeof import("@/app/api/upload-complete/route").POST;
let sql: typeof import("@/lib/db").sql;
let updateSettings: typeof import("@/lib/db").updateSettings;
let embedImage: ReturnType<typeof vi.fn>;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

// A real, tiny JPEG that `makePreviews` (sharp) can genuinely process.
let smallJpeg: Buffer;

type FileSpec = { name: string; type: string; size: number; kind: "photo" | "video" };

function urlReq(body: unknown): Request {
  return new Request("http://localhost/api/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    body: JSON.stringify(body),
  });
}

function completeReq(body: unknown): Request {
  return new Request("http://localhost/api/upload-complete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  updateSettings = db.updateSettings;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
  }

  const embed = await import("@/lib/embed-client");
  embedImage = embed.embedImage as unknown as ReturnType<typeof vi.fn>;

  // Import the routes last, so they bind to the test-schema db + mocked embed.
  uploadUrlPOST = (await import("@/app/api/upload-url/route")).POST;
  uploadCompletePOST = (await import("@/app/api/upload-complete/route")).POST;

  smallJpeg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

beforeEach(async () => {
  s3mock.reset();
  s3mock.on(PutObjectCommand).resolves({});
  // Every GetObjectCommand yields a fresh readable of the real small JPEG.
  s3mock.on(GetObjectCommand).callsFake(() => ({ Body: Readable.from(smallJpeg) }));

  embedImage.mockReset();
  embedImage.mockResolvedValue({
    faces: [{ embedding: unitVector(DIM, 0), bbox: [0, 0, 50, 50], det_score: 0.98 }],
  });

  await sql`delete from faces`;
  await sql`delete from photos`;
  await sql`delete from media`;
  await sql`delete from upload_events`;
});

describe("POST /api/upload-url (integration, isolated schema)", () => {
  it("grants only the remaining photo quota and truncates the extras", async () => {
    const sessionId = randomUUID();
    // 18 photos already used this session -> only 2 remain of the 20 cap.
    await sql`
      insert into upload_events (upload_session, photo_count, video_count)
      values (${sessionId}, 18, 0)`;

    const files: FileSpec[] = Array.from({ length: 5 }, (_, i) => ({
      name: `photo-${i}.jpg`,
      type: "image/jpeg",
      size: 2_000_000,
      kind: "photo",
    }));

    const res = await uploadUrlPOST(urlReq({ sessionId, guestName: "Alice", files }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      grants: { name: string; key: string; putUrl: string }[];
      remaining: { photos: number; videos: number };
    };
    expect(body.grants).toHaveLength(2);
    expect(body.remaining.photos).toBe(0);
    expect(body.remaining.videos).toBe(5);
    for (const g of body.grants) {
      expect(g.key).toMatch(new RegExp(`^uploads/${sessionId}/[0-9a-f-]{36}\\.jpg$`));
      expect(g.putUrl).toContain("http");
    }
  });

  it("rejects a video over the 300MB cap (no grant, quota untouched)", async () => {
    const sessionId = randomUUID();
    const files: FileSpec[] = [
      { name: "big.mp4", type: "video/mp4", size: 301 * 1024 * 1024, kind: "video" },
    ];

    const res = await uploadUrlPOST(urlReq({ sessionId, guestName: "Bob", files }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      grants: unknown[];
      remaining: { photos: number; videos: number };
    };
    expect(body.grants).toHaveLength(0);
    expect(body.remaining.videos).toBe(5);
  });

  it("B1: a rotated sessionId still can't exceed the per-IP quota", async () => {
    // The IP (1.2.3.4, from urlReq's forwarded-for) already used its full 20
    // photos + 5 videos across earlier sessions — even under DIFFERENT sessions.
    await sql`insert into upload_events (upload_session, ip, photo_count, video_count)
      values (${randomUUID()}, '1.2.3.4', 20, 5)`;

    // A brand-new (rotated) sessionId with zero per-session usage.
    const freshSession = randomUUID();
    const files: FileSpec[] = [
      { name: "p.jpg", type: "image/jpeg", size: 1_000_000, kind: "photo" },
      { name: "v.mp4", type: "video/mp4", size: 1_000_000, kind: "video" },
    ];

    const res = await uploadUrlPOST(urlReq({ sessionId: freshSession, files }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      grants: unknown[];
      remaining: { photos: number; videos: number };
    };
    // Per-IP quota is exhausted -> no grants despite the fresh session.
    expect(body.grants).toHaveLength(0);
    expect(body.remaining.photos).toBe(0);
    expect(body.remaining.videos).toBe(0);
  });

  it("B4b: upload-url returns 503 {maintenance} when the kill switch is on", async () => {
    await updateSettings({ killSwitch: true });
    try {
      const res = await uploadUrlPOST(
        urlReq({
          sessionId: randomUUID(),
          files: [{ name: "p.jpg", type: "image/jpeg", size: 1000, kind: "photo" }],
        }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "maintenance" });
    } finally {
      await updateSettings({ killSwitch: false });
    }
  });
});

describe("POST /api/upload-complete (integration, isolated schema)", () => {
  it("processes an uploaded photo: inserts a photo row + at least one face", async () => {
    const sessionId = randomUUID();
    const key = `uploads/${sessionId}/${randomUUID()}.jpg`;

    const res = await uploadCompletePOST(
      completeReq({ sessionId, guestName: "Cara", keys: [key] }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { processed: number; photos: number; videos: number };
    expect(body.processed).toBe(1);
    expect(body.photos).toBe(1);
    expect(body.videos).toBe(0);

    const photos = await sql<
      { id: string; source: string; uploaded_by: string | null; original_key: string }[]
    >`select id, source, uploaded_by, original_key from photos where upload_session = ${sessionId}`;
    expect(photos).toHaveLength(1);
    expect(photos[0].source).toBe("guest_upload");
    expect(photos[0].uploaded_by).toBe("Cara");
    expect(photos[0].original_key).toBe(key);

    const faces = await sql`select id from faces where photo_id = ${photos[0].id}`;
    expect(faces.length).toBeGreaterThanOrEqual(1);

    // The upload was audit-logged with the processed counts.
    const events = await sql<
      { photo_count: number; video_count: number }[]
    >`select photo_count, video_count from upload_events where upload_session = ${sessionId}`;
    expect(events).toHaveLength(1);
    expect(Number(events[0].photo_count)).toBe(1);
    expect(Number(events[0].video_count)).toBe(0);
  });

  it("B1: rejects a key outside uploads/<sessionId>/ with 400 {invalid_key}", async () => {
    const sessionId = randomUUID();
    const otherSession = randomUUID();
    // A key pointing at a DIFFERENT session's prefix must be refused.
    const foreignKey = `uploads/${otherSession}/${randomUUID()}.jpg`;

    const res = await uploadCompletePOST(
      completeReq({ sessionId, guestName: "Mallory", keys: [foreignKey] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_key" });

    // Nothing was processed / inserted.
    const photos = await sql`select id from photos where upload_session = ${sessionId}`;
    expect(photos).toHaveLength(0);
  });

  it("B1: rejects a batch of more than 25 keys with 400 {too_many_keys}", async () => {
    const sessionId = randomUUID();
    const keys = Array.from(
      { length: 26 },
      () => `uploads/${sessionId}/${randomUUID()}.jpg`,
    );

    const res = await uploadCompletePOST(completeReq({ sessionId, guestName: "Spam", keys }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too_many_keys" });
  });

  it("B4b: upload-complete returns 503 {maintenance} when the kill switch is on", async () => {
    await updateSettings({ killSwitch: true });
    try {
      const sessionId = randomUUID();
      const res = await uploadCompletePOST(
        completeReq({
          sessionId,
          keys: [`uploads/${sessionId}/${randomUUID()}.jpg`],
        }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "maintenance" });
    } finally {
      await updateSettings({ killSwitch: false });
    }
  });
});
