// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// This suite exercises the admin media + settings routes end-to-end against an
// isolated `shaadi_test_integ` schema (real Postgres DDL — never `public`, per
// the project's integration-testing convention). R2 is mocked (aws-sdk-client-mock)
// even though these two routes never issue an R2 command themselves — `r2.ts`
// constructs its S3Client at import time, so patching the class keeps the suite
// fully offline regardless of internal implementation details.

const TEST_SCHEMA = "shaadi_test_integ";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

const PASSWORD = process.env.ADMIN_PASSWORD as string;

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let loginPOST: typeof import("@/app/api/admin/login/route").POST;
let mediaGET: typeof import("@/app/api/admin/media/route").GET;
let settingsGET: typeof import("@/app/api/admin/settings/route").GET;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

let photoA: { id: string };
let photoB: { id: string };

/** Extract the raw `shaadi_admin=<token>` pair from a login response cookie. */
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on response");
  return setCookie.split(";")[0];
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  insertPhoto = db.insertPhoto;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Import the routes last, so they bind to the test-schema db client.
  loginPOST = (await import("@/app/api/admin/login/route")).POST;
  mediaGET = (await import("@/app/api/admin/media/route")).GET;
  settingsGET = (await import("@/app/api/admin/settings/route")).GET;

  // Seed two active photos with the app's real key layout.
  const a = await insertPhoto({
    source: "guest_upload",
    contentHash: randomUUID(),
    originalKey: "originals/a.jpg",
    previewKey: "medium/a.webp",
    thumbKey: "thumb/a.webp",
    uploadedBy: "Priya",
    bytes: 2048,
  });
  photoA = { id: a.id };

  const b = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "originals/b.jpg",
    previewKey: "medium/b.webp",
    thumbKey: "thumb/b.webp",
    bytes: 4096,
  });
  photoB = { id: b.id };
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

describe("admin media + settings routes (integration, isolated shaadi_test_integ schema)", () => {
  it("GET /admin/media without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/media");
    const res = await mediaGET(req);
    expect(res.status).toBe(401);
  });

  it("GET /admin/settings without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/settings");
    const res = await settingsGET(req);
    expect(res.status).toBe(401);
  });

  it("GET /admin/media with a valid admin cookie returns the seeded photos", async () => {
    const login = await loginPOST(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const cookie = cookieFrom(login);

    const req = new Request("http://localhost/api/admin/media", { headers: { cookie } });
    const res = await mediaGET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      media: { id: string; kind: string; guest: string | null; thumbUrl: string; uploadedAt: string }[];
    };
    expect(Array.isArray(body.media)).toBe(true);

    const ids = body.media.map((m) => m.id);
    expect(ids).toContain(photoA.id);
    expect(ids).toContain(photoB.id);

    const itemA = body.media.find((m) => m.id === photoA.id);
    expect(itemA?.kind).toBe("photo");
    expect(itemA?.guest).toBe("Priya");
    expect(itemA?.thumbUrl).toBe(`${process.env.R2_PREVIEWS_PUBLIC_URL}/thumb/a.webp`);
    expect(new Date(itemA?.uploadedAt ?? "").toString()).not.toBe("Invalid Date");

    // The ingest-sourced photo has no uploader — `guest` reflects that as null.
    const itemB = body.media.find((m) => m.id === photoB.id);
    expect(itemB?.guest).toBeNull();
    expect(itemB?.thumbUrl).toBe(`${process.env.R2_PREVIEWS_PUBLIC_URL}/thumb/b.webp`);
  });

  it("GET /admin/settings with a valid admin cookie returns the current settings", async () => {
    const login = await loginPOST(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const cookie = cookieFrom(login);

    const req = new Request("http://localhost/api/admin/settings", { headers: { cookie } });
    const res = await settingsGET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      match_threshold: number;
      passcode_enabled: boolean;
      kill_switch: boolean;
    };
    expect(typeof body.match_threshold).toBe("number");
    expect(typeof body.passcode_enabled).toBe("boolean");
    expect(typeof body.kill_switch).toBe("boolean");
    expect(body).not.toHaveProperty("passcode_hash");
  });
});
