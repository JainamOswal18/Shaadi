// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This suite exercises the admin API end-to-end against an isolated
// `shaadi_test_admin` schema (real Postgres DDL — never `public`). The only
// external side effect stubbed is R2 object deletion (aws-sdk-client-mock):
// DeleteObjectCommand resolves without hitting the network so we can assert the
// exact set of keys/buckets the delete route targets.

// Distinct schema so parallel Vitest workers never contend on create/drop.
const TEST_SCHEMA = "shaadi_test_admin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

// Patch the S3 client class before r2.ts constructs its instance (on import).
const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

const PASSWORD = process.env.ADMIN_PASSWORD as string;

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let getSettings: typeof import("@/lib/db").getSettings;
let loginPOST: typeof import("@/app/api/admin/login/route").POST;
let logsGET: typeof import("@/app/api/admin/logs/route").GET;
let settingsPATCH: typeof import("@/app/api/admin/settings/route").PATCH;
let deletePOST: typeof import("@/app/api/admin/delete/route").POST;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

let photo: { id: string };

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
  getSettings = db.getSettings;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Import the routes last, so they bind to the test-schema db client.
  loginPOST = (await import("@/app/api/admin/login/route")).POST;
  logsGET = (await import("@/app/api/admin/logs/route")).GET;
  settingsPATCH = (await import("@/app/api/admin/settings/route")).PATCH;
  deletePOST = (await import("@/app/api/admin/delete/route")).POST;

  // Seed one active photo with the app's real key layout + an audit log row.
  const p = await insertPhoto({
    source: "guest_upload",
    contentHash: randomUUID(),
    originalKey: "originals/pic.jpg",
    previewKey: "medium/pic.webp",
    thumbKey: "thumb/pic.webp",
    bytes: 4096,
  });
  photo = { id: p.id };

  await sql`
    insert into search_sessions (guest_name, ip, match_count)
    values ('Guest', '1.2.3.4', 3)`;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

beforeEach(() => {
  s3mock.reset();
  s3mock.on(DeleteObjectCommand).resolves({});
});

describe("admin API (integration, isolated schema)", () => {
  it("POST /admin/login with a wrong password returns 401", async () => {
    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: "definitely-not-the-password" }),
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("POST /admin/login with the correct password returns 200 + shaadi_admin cookie", async () => {
    const req = new Request("http://localhost/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("shaadi_admin=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  it("GET /admin/logs without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/logs?page=1");
    const res = await logsGET(req);
    expect(res.status).toBe(401);
  });

  it("GET /admin/logs with a valid signed cookie returns 200 + paginated logs", async () => {
    const login = await loginPOST(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const cookie = cookieFrom(login);

    const req = new Request("http://localhost/api/admin/logs?page=1", {
      headers: { cookie },
    });
    const res = await logsGET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      logs: { id: string; type: string; guest: string; detail: string; at: string }[];
      page: number;
      pageSize: number;
      total: number;
    };
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThanOrEqual(1);
    expect(body.page).toBe(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("PATCH /admin/settings toggling kill_switch persists and is reflected by getSettings", async () => {
    const login = await loginPOST(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const cookie = cookieFrom(login);

    expect((await getSettings()).killSwitch).toBe(false);

    const req = new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      headers: { cookie },
      body: JSON.stringify({ kill_switch: true }),
    });
    const res = await settingsPATCH(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kill_switch: boolean };
    expect(body.kill_switch).toBe(true);

    expect((await getSettings()).killSwitch).toBe(true);
  });

  it("PATCH /admin/settings without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({ kill_switch: true }),
    });
    const res = await settingsPATCH(req);
    expect(res.status).toBe(401);
  });

  it("POST /admin/delete flips the photo to 'deleted' and issues R2 delete calls", async () => {
    const login = await loginPOST(
      new Request("http://localhost/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const cookie = cookieFrom(login);

    const req = new Request("http://localhost/api/admin/delete", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ photoId: photo.id }),
    });
    const res = await deletePOST(req);
    expect(res.status).toBe(200);

    const rows = await sql<{ status: string }[]>`select status from photos where id = ${photo.id}`;
    expect(rows[0].status).toBe("deleted");

    // Original + thumb + medium webp + medium avif were all deleted from R2.
    const calls = s3mock.commandCalls(DeleteObjectCommand);
    const deleted = calls.map((c) => c.args[0].input as { Bucket?: string; Key?: string });
    const keys = deleted.map((d) => d.Key).sort();
    expect(keys).toEqual(
      ["medium/pic.avif", "medium/pic.webp", "originals/pic.jpg", "thumb/pic.webp"].sort(),
    );
    // The original lives in the originals bucket; previews in the previews bucket.
    const originalCall = deleted.find((d) => d.Key === "originals/pic.jpg");
    expect(originalCall?.Bucket).toBe(process.env.R2_BUCKET_ORIGINALS ?? "shaadi-photos");
    const thumbCall = deleted.find((d) => d.Key === "thumb/pic.webp");
    expect(thumbCall?.Bucket).toBe(process.env.R2_BUCKET_PREVIEWS ?? "shaadi-previews");
  });

  it("POST /admin/delete without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/delete", {
      method: "POST",
      body: JSON.stringify({ photoId: photo.id }),
    });
    const res = await deletePOST(req);
    expect(res.status).toBe(401);
  });
});
