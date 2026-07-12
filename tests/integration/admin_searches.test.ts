// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// This suite exercises `db.listSearches` and `GET /api/admin/searches`
// end-to-end against an isolated `shaadi_test_searches` schema (real Postgres
// DDL — never `public`, per the project's integration-testing convention). R2
// is mocked (aws-sdk-client-mock) even though the route only *signs* a GET URL
// (no network call) — r2.ts constructs its S3Client at import time, so
// patching the class keeps the suite fully offline regardless of internal
// implementation details.

const TEST_SCHEMA = "shaadi_test_searches";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

const PASSWORD = process.env.ADMIN_PASSWORD as string;

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let listSearches: typeof import("@/lib/db").listSearches;
let logSearch: typeof import("@/lib/db").logSearch;
let loginPOST: typeof import("@/app/api/admin/login/route").POST;
let searchesGET: typeof import("@/app/api/admin/searches/route").GET;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

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
  listSearches = db.listSearches;
  logSearch = db.logSearch;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Import the routes last, so they bind to the test-schema db client.
  loginPOST = (await import("@/app/api/admin/login/route")).POST;
  searchesGET = (await import("@/app/api/admin/searches/route")).GET;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

describe("db.listSearches (integration, isolated shaadi_test_searches schema)", () => {
  it("returns recent search sessions newest first, with the fields the admin view needs", async () => {
    await sql`delete from search_sessions`;

    const older = await logSearch({
      guestName: "Priya",
      selfieKey: null,
      matchCount: 2,
    });
    await sql`update search_sessions set created_at = now() - interval '1 hour' where id = ${older.id}`;

    const newer = await logSearch({
      guestName: "Rohit",
      selfieKey: "selfies/abc.jpg",
      matchCount: 5,
    });

    const rows = await listSearches({ limit: 10, offset: 0 });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(rows[0].id).toBe(newer.id);
    expect(rows[0].guest_name).toBe("Rohit");
    expect(rows[0].selfie_key).toBe("selfies/abc.jpg");
    expect(rows[0].match_count).toBe(5);
    const olderRow = rows.find((r) => r.id === older.id);
    expect(olderRow?.guest_name).toBe("Priya");
    expect(olderRow?.selfie_key).toBeNull();
  });

  it("respects limit/offset for pagination", async () => {
    await sql`delete from search_sessions`;
    for (let i = 0; i < 5; i++) {
      await logSearch({ guestName: `Guest${i}`, matchCount: i });
    }
    const page1 = await listSearches({ limit: 2, offset: 0 });
    const page2 = await listSearches({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((r) => r.id)).not.toEqual(page2.map((r) => r.id));
  });
});

describe("GET /api/admin/searches (integration, isolated shaadi_test_searches schema)", () => {
  it("without a cookie returns 401", async () => {
    const req = new Request("http://localhost/api/admin/searches");
    const res = await searchesGET(req);
    expect(res.status).toBe(401);
  });

  it("with a valid admin cookie returns 200 and the expected shape", async () => {
    await sql`delete from search_sessions`;
    await logSearch({ guestName: "Meera", selfieKey: "selfies/meera.jpg", matchCount: 3 });
    await logSearch({ guestName: null, selfieKey: null, matchCount: 0 });

    const cookie = await adminCookie();
    const req = new Request("http://localhost/api/admin/searches?limit=10&offset=0", {
      headers: { cookie },
    });
    const res = await searchesGET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      searches: {
        id: string;
        guestName: string | null;
        at: string;
        matchCount: number;
        selfieUrl: string | null;
      }[];
      hasMore: boolean;
    };
    expect(Array.isArray(body.searches)).toBe(true);
    expect(body.searches.length).toBeGreaterThanOrEqual(2);

    const withSelfie = body.searches.find((s) => s.guestName === "Meera");
    expect(withSelfie?.matchCount).toBe(3);
    expect(withSelfie?.selfieUrl).toBeTruthy();
    expect(withSelfie?.selfieUrl).toContain("selfies/meera.jpg");
    expect(new Date(withSelfie?.at ?? "").toString()).not.toBe("Invalid Date");

    const withoutSelfie = body.searches.find((s) => s.guestName === null);
    expect(withoutSelfie?.selfieUrl).toBeNull();
    expect(withoutSelfie?.matchCount).toBe(0);
  });

  it("hasMore reflects whether the page came back full", async () => {
    await sql`delete from search_sessions`;
    for (let i = 0; i < 3; i++) {
      await logSearch({ guestName: `G${i}`, matchCount: i });
    }
    const cookie = await adminCookie();

    const full = await searchesGET(
      new Request("http://localhost/api/admin/searches?limit=2&offset=0", {
        headers: { cookie },
      }),
    );
    const fullBody = (await full.json()) as { hasMore: boolean };
    expect(fullBody.hasMore).toBe(true);

    const short = await searchesGET(
      new Request("http://localhost/api/admin/searches?limit=2&offset=2", {
        headers: { cookie },
      }),
    );
    const shortBody = (await short.json()) as { hasMore: boolean };
    expect(shortBody.hasMore).toBe(false);
  });
});
