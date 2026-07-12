// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the real search route end-to-end against an isolated
// `shaadi_test` schema (real Postgres DDL + pgvector search), with only the two
// external side effects stubbed: the face-embedding HTTP call (mocked module)
// and R2 object storage (aws-sdk-client-mock). Nothing touches production data
// or real object storage.

// Distinct from other integration suites' schema so parallel Vitest workers
// never contend on the same schema's create/drop (which deadlocks Postgres).
const TEST_SCHEMA = "shaadi_test_search";
const DIM = 512;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

function unitVector(dim: number, hotIndex: number): number[] {
  const v = new Array(dim).fill(0);
  v[hotIndex] = 1;
  return v;
}

// Mock only the embedding HTTP client; keep the real `largestFace` selector so
// the route's face-picking logic is genuinely exercised.
vi.mock("@/lib/embed-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embed-client")>();
  return { ...actual, embedImage: vi.fn() };
});

// Patch the S3 client class before r2.ts constructs its instance (on import).
const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let POST: typeof import("@/app/api/search/route").POST;
let configGET: typeof import("@/app/api/config/route").GET;
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let insertFaces: typeof import("@/lib/db").insertFaces;
let updateSettings: typeof import("@/lib/db").updateSettings;
let embedImage: ReturnType<typeof vi.fn>;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

let nearPhotoId: string;

function makeRequest(opts: {
  ip?: string;
  guestName?: string;
  omitSelfie?: boolean;
  passcode?: string;
}): Request {
  const fd = new FormData();
  if (opts.guestName !== undefined) fd.set("guestName", opts.guestName);
  if (opts.passcode !== undefined) fd.set("passcode", opts.passcode);
  if (!opts.omitSelfie) {
    // A tiny JPEG-ish byte blob; content is irrelevant since embed is mocked.
    fd.set(
      "selfie",
      new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], "selfie.jpg", { type: "image/jpeg" }),
    );
  }
  const headers: Record<string, string> = { "user-agent": "vitest-agent" };
  if (opts.ip) headers["x-forwarded-for"] = `${opts.ip}, 10.0.0.1`;
  return new Request("http://localhost/api/search", { method: "POST", headers, body: fd });
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  insertPhoto = db.insertPhoto;
  insertFaces = db.insertFaces;
  updateSettings = db.updateSettings;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Grab the same mocked embedImage instance the route imports.
  const embed = await import("@/lib/embed-client");
  embedImage = embed.embedImage as unknown as ReturnType<typeof vi.fn>;

  // Import the routes last, so they bind to the test-schema db + mocked embed.
  POST = (await import("@/app/api/search/route")).POST;
  configGET = (await import("@/app/api/config/route")).GET;

  // Seed one matching photo (aligned with the fixed selfie vector) and one that
  // is orthogonal (should never match at the default 0.38 threshold).
  const near = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/near.jpg",
    previewKey: "preview/near.jpg",
    thumbKey: "thumb/near.jpg",
  });
  const far = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/far.jpg",
    previewKey: "preview/far.jpg",
    thumbKey: "thumb/far.jpg",
  });
  await insertFaces(near.id, [{ embedding: unitVector(DIM, 0) }]);
  await insertFaces(far.id, [{ embedding: unitVector(DIM, 300) }]);
  nearPhotoId = near.id;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

beforeEach(() => {
  s3mock.reset();
  s3mock.on(PutObjectCommand).resolves({});
  embedImage.mockReset();
  // Default: one detected face aligned with the seeded "near" photo.
  embedImage.mockResolvedValue({
    faces: [{ embedding: unitVector(DIM, 0), bbox: [0, 0, 100, 100], det_score: 0.99 }],
  });
});

afterEach(async () => {
  // Keep the DB clean between tests: settings back to default, sessions cleared.
  await updateSettings({ killSwitch: false, passcodeEnabled: false });
  await sql`delete from search_sessions`;
});

describe("POST /api/search (integration, isolated schema)", () => {
  it("returns 200 with only the matching photo and public preview URLs", async () => {
    const res = await POST(makeRequest({ ip: "9.9.9.9", guestName: "Alice" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      sessionId: string;
      matches: { photoId: string; thumbUrl: string; previewUrl: string }[];
    };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].photoId).toBe(nearPhotoId);

    const previewsBase = process.env.R2_PREVIEWS_PUBLIC_URL as string;
    expect(body.matches[0].thumbUrl).toBe(`${previewsBase}/thumb/near.jpg`);
    expect(body.matches[0].thumbUrl.startsWith(previewsBase)).toBe(true);
    expect(body.matches[0].previewUrl).toBe(`${previewsBase}/preview/near.jpg`);

    // B3: the selfie is NEVER persisted — no object is put to R2 at all.
    expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);

    // A search session was logged, and selfie_key is null (nothing retained).
    const rows = await sql`select match_count, guest_name, selfie_key from search_sessions`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].match_count)).toBe(1);
    expect(rows[0].guest_name).toBe("Alice");
    expect(rows[0].selfie_key).toBeNull();
  });

  it("B3: does not put any object under selfies/ and logs selfie_key=null", async () => {
    const res = await POST(makeRequest({ ip: "9.9.9.9", guestName: "NoStore" }));
    expect(res.status).toBe(200);

    // No PutObjectCommand at all, and specifically nothing keyed under selfies/.
    const puts = s3mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(0);
    const selfiePuts = puts.filter((c) =>
      String((c.args[0].input as { Key?: string }).Key ?? "").startsWith("selfies/"),
    );
    expect(selfiePuts).toHaveLength(0);

    const rows = await sql`select selfie_key from search_sessions`;
    expect(rows).toHaveLength(1);
    expect(rows[0].selfie_key).toBeNull();
  });

  it("B6: requires a passcode when enabled (403 without, 200 with correct)", async () => {
    const { hashPasscode } = await import("@/lib/passcode");
    await updateSettings({
      passcodeEnabled: true,
      passcodeHash: await hashPasscode("open-sesame"),
    });

    // Missing passcode -> 403 {error:"passcode"}, no embed work done.
    const missing = await POST(makeRequest({ ip: "9.9.9.9" }));
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ error: "passcode" });
    expect(embedImage).not.toHaveBeenCalled();

    // Wrong passcode -> 403.
    const wrong = await POST(makeRequest({ ip: "9.9.9.9", passcode: "nope" }));
    expect(wrong.status).toBe(403);
    expect(embedImage).not.toHaveBeenCalled();

    // Correct passcode -> 200 with the matching photo.
    const ok = await POST(makeRequest({ ip: "9.9.9.9", passcode: "open-sesame" }));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { matches: { photoId: string }[] };
    expect(body.matches[0].photoId).toBe(nearPhotoId);
  });

  it("B6: GET /api/config reflects passcodeRequired", async () => {
    const off = await configGET();
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ passcodeRequired: false });

    await updateSettings({ passcodeEnabled: true });
    const on = await configGET();
    expect(await on.json()).toEqual({ passcodeRequired: true });
  });

  it("returns 503 when the kill switch is on", async () => {
    await updateSettings({ killSwitch: true });
    const res = await POST(makeRequest({ ip: "9.9.9.9" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
    // Short-circuits before any embed/search/storage work.
    expect(embedImage).not.toHaveBeenCalled();
  });

  it("returns 400 when the selfie file is missing", async () => {
    const res = await POST(makeRequest({ ip: "9.9.9.9", guestName: "Bob", omitSelfie: true }));
    expect(res.status).toBe(400);
  });

  it("returns 422 when no face is detected", async () => {
    embedImage.mockResolvedValue({ faces: [] });
    const res = await POST(makeRequest({ ip: "9.9.9.9" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_face" });
  });

  it("rate-limits: the 31st request from an IP within an hour is 429", async () => {
    const ip = "5.5.5.5";
    // Seed 30 sessions from this IP inside the window.
    for (let i = 0; i < 30; i++) {
      await sql`insert into search_sessions (ip) values (${ip})`;
    }
    const res = await POST(makeRequest({ ip }));
    expect(res.status).toBe(429);
    // Blocked before doing any embedding work.
    expect(embedImage).not.toHaveBeenCalled();
  });
});
