// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// This suite runs the real migration DDL against an isolated `shaadi_test`
// schema (never `public`) so it cannot pollute or depend on production data.
// Isolation is deterministic: db.ts pins `search_path` to the test schema on
// EVERY pooled connection (via DB_SCHEMA), so it never relies on a single
// connection's leftover `SET search_path`. The schema is dropped in afterAll.

const TEST_SCHEMA = "shaadi_test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

const DIM = 512;
function unitVector(dim: number, hotIndex: number): number[] {
  const v = new Array(dim).fill(0);
  v[hotIndex] = 1;
  return v;
}

// Loaded fresh (after DB_SCHEMA is set) in beforeAll.
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let insertFaces: typeof import("@/lib/db").insertFaces;
let searchByEmbedding: typeof import("@/lib/db").searchByEmbedding;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  // Point db.ts's pooled client at the test schema, then import it fresh so
  // the module-level `sql` (and cached env) pick up DB_SCHEMA.
  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();
  const db = await import("@/lib/db");
  sql = db.sql;
  insertPhoto = db.insertPhoto;
  insertFaces = db.insertFaces;
  searchByEmbedding = db.searchByEmbedding;

  // Run migrations through the db client (search_path -> shaadi_test,public),
  // so all DDL lands in the isolated schema.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const contents = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await sql.unsafe(contents);
  }
});

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
});

describe("db integration (isolated shaadi_test schema)", () => {
  it("searchByEmbedding returns exactly the near photo", async () => {
    const probe = unitVector(DIM, 0);
    const nearEmbedding = unitVector(DIM, 0); // same direction as probe -> similarity ~1.0
    const farEmbedding = unitVector(DIM, 300); // orthogonal to probe -> similarity ~0.0

    const nearPhoto = await insertPhoto({
      source: "ingest",
      contentHash: randomUUID(),
      originalKey: "orig/near.jpg",
      previewKey: "preview/near.jpg",
      thumbKey: "thumb/near.jpg",
    });
    const farPhoto = await insertPhoto({
      source: "ingest",
      contentHash: randomUUID(),
      originalKey: "orig/far.jpg",
      previewKey: "preview/far.jpg",
      thumbKey: "thumb/far.jpg",
    });

    await insertFaces(nearPhoto.id, [{ embedding: nearEmbedding }]);
    await insertFaces(farPhoto.id, [{ embedding: farEmbedding }]);

    const results = await searchByEmbedding(probe, 0.38, 10);

    expect(results).toHaveLength(1);
    expect(results[0].photoId).toBe(nearPhoto.id);
    expect(results[0].thumbKey).toBe("thumb/near.jpg");
    expect(results[0].previewKey).toBe("preview/near.jpg");
    expect(results[0].similarity).toBeCloseTo(1, 5);
  });
});
