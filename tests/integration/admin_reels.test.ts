// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// This suite exercises `GET /api/admin/reels` end-to-end against an isolated
// `shaadi_test_reels_admin` schema (real Postgres DDL — never `public`, per the
// project's integration-testing convention). R2 is mocked (aws-sdk-client-mock)
// even though `presignGet` only *signs* a URL locally (no network call) — r2.ts
// constructs its S3Client at import time, so patching the class keeps the suite
// fully offline regardless of internal implementation details.

const TEST_SCHEMA = "shaadi_test_reels_admin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

const PASSWORD = process.env.ADMIN_PASSWORD as string;

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let insertReelJob: typeof import("@/lib/db").insertReelJob;
let setReelJobStatus: typeof import("@/lib/db").setReelJobStatus;
let loginPOST: typeof import("@/app/api/admin/login/route").POST;
let reelsGET: typeof import("@/app/api/admin/reels/route").GET;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

const SPEC = {
  photoIds: ["11111111-1111-4111-8111-111111111111"],
  aspect: "4:5",
  totalSeconds: 20,
  transition: "kenburns",
  song: { id: "silent", startSec: 0 },
};

/** Extract the raw `shaadi_admin=<token>` pair from a login response cookie. */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on response");
  return setCookie.split(";")[0];
}

async function adminCookie(): Promise<string> {
  const res = await loginPOST(
    new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    }),
  );
  return cookieFrom(res);
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  insertReelJob = db.insertReelJob;
  setReelJobStatus = db.setReelJobStatus;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Import the routes last, so they bind to the test-schema db client.
  loginPOST = (await import("@/app/api/admin/login/route")).POST;
  reelsGET = (await import("@/app/api/admin/reels/route")).GET;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

describe("GET /api/admin/reels (integration, isolated shaadi_test_reels_admin schema)", () => {
  it("without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/reels");
    const res = await reelsGET(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("with a valid admin cookie returns done reels with signed urls, excluding queued/rendering", async () => {
    await sql`delete from reel_jobs`;

    const done = await insertReelJob({ spec: SPEC, guestName: "Asha" });
    await setReelJobStatus(done.id, { status: "done", outputKey: "reels/asha.mp4" });

    const queued = await insertReelJob({ spec: SPEC, guestName: "Rohit" });
    void queued; // stays "queued" — must be excluded

    const rendering = await insertReelJob({ spec: SPEC, guestName: "Meera" });
    await setReelJobStatus(rendering.id, { status: "rendering" });

    const errored = await insertReelJob({ spec: SPEC, guestName: "Vikram" });
    await setReelJobStatus(errored.id, { status: "error", error: "ffmpeg exploded" });

    const cookie = await adminCookie();
    const req = new Request("http://localhost/api/admin/reels", { headers: { cookie } });
    const res = await reelsGET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      reels: { id: string; guest: string | null; url: string; createdAt: string }[];
    };
    expect(Array.isArray(body.reels)).toBe(true);
    expect(body.reels).toHaveLength(1);

    const reel = body.reels[0];
    expect(reel.id).toBe(done.id);
    expect(reel.guest).toBe("Asha");
    expect(reel.url).toContain("reels/asha.mp4");
    expect(new Date(reel.createdAt).toString()).not.toBe("Invalid Date");
  });
});
