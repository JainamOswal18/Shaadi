// @vitest-environment node
//
// Pure-logic / SQL-shape tests for the `reel_jobs` migration + db helpers.
// Deliberately does NOT open a real database connection: the `postgres`
// package is fully mocked so `@/lib/db`'s `sql` tagged template just records
// the query text + interpolated values instead of hitting a socket. This lets
// us verify the query shape (table/columns/branches) the same way the real
// Neon-backed integration suites do, without ever touching the live DB that
// `DATABASE_URL` points at.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../src/db/migrations/0004_reel_jobs.sql",
);

type Call = { text: string; values: unknown[] };

function makeSqlMock() {
  const calls: Call[] = [];
  let nextResult: unknown[] = [];

  function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(nextResult);
  }
  sqlTag.json = vi.fn((obj: unknown) => ({ __json: obj }));
  sqlTag.end = vi.fn(async () => undefined);

  return {
    calls,
    setNextResult: (rows: unknown[]) => {
      nextResult = rows;
    },
    sqlTag: sqlTag as unknown as import("postgres").Sql,
  };
}

describe("0004_reel_jobs.sql migration shape", () => {
  const contents = readFileSync(MIGRATION_PATH, "utf8");

  it("creates the reel_jobs table with the expected columns", () => {
    expect(contents).toMatch(/create table reel_jobs/i);
    expect(contents).toMatch(/id uuid primary key default gen_random_uuid\(\)/i);
    expect(contents).toMatch(/status text not null default 'queued'/i);
    expect(contents).toMatch(/spec jsonb not null/i);
    expect(contents).toMatch(/output_key text/i);
    expect(contents).toMatch(/error text/i);
    expect(contents).toMatch(/session_id uuid/i);
    expect(contents).toMatch(/guest_name text/i);
    expect(contents).toMatch(/\bip text\b/i);
    expect(contents).toMatch(/created_at timestamptz not null default now\(\)/i);
    expect(contents).toMatch(/updated_at timestamptz not null default now\(\)/i);
  });

  it("constrains status to the four job states", () => {
    expect(contents).toMatch(
      /check\s*\(\s*status in \('queued','rendering','done','error'\)\s*\)/i,
    );
  });

  it("indexes (status, created_at desc) for the listReels/pending-job query pattern", () => {
    expect(contents).toMatch(
      /create index if not exists reel_jobs_status_created on reel_jobs\(status, created_at desc\)/i,
    );
  });
});

describe("reel_jobs db helpers (mocked postgres — no real DB connection)", () => {
  let mock: ReturnType<typeof makeSqlMock>;

  beforeEach(() => {
    vi.resetModules();
    mock = makeSqlMock();
    vi.doMock("postgres", () => ({ default: vi.fn(() => mock.sqlTag) }));
  });

  afterEach(() => {
    vi.doUnmock("postgres");
  });

  it("insertReelJob issues an insert into reel_jobs and returns the new id", async () => {
    mock.setNextResult([{ id: "job-1" }]);
    const { insertReelJob } = await import("@/lib/db");

    const result = await insertReelJob({
      spec: { photoIds: ["a"] },
      sessionId: "sess-1",
      guestName: "Priya",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ id: "job-1" });
    const call = mock.calls.at(-1)!;
    expect(call.text).toMatch(/insert into reel_jobs/i);
    expect(call.text).toMatch(/returning id/i);
    // spec is passed through sql.json(...); session/guest/ip passed as-is.
    expect(call.values).toEqual([
      { __json: { photoIds: ["a"] } },
      "sess-1",
      "Priya",
      "1.2.3.4",
    ]);
  });

  it("insertReelJob defaults optional fields to null", async () => {
    mock.setNextResult([{ id: "job-2" }]);
    const { insertReelJob } = await import("@/lib/db");

    await insertReelJob({ spec: { photoIds: [] } });

    const call = mock.calls.at(-1)!;
    expect(call.values).toEqual([{ __json: { photoIds: [] } }, null, null, null]);
  });

  it("getReelJob selects by id from reel_jobs", async () => {
    mock.setNextResult([
      { id: "job-1", status: "queued", output_key: null, error: null },
    ]);
    const { getReelJob } = await import("@/lib/db");

    const row = await getReelJob("job-1");

    expect(row).toEqual({ id: "job-1", status: "queued", output_key: null, error: null });
    const call = mock.calls.at(-1)!;
    expect(call.text).toMatch(/select id, status, output_key, error from reel_jobs where id/i);
    expect(call.values).toEqual(["job-1"]);
  });

  it("getReelJob returns null when no row matches", async () => {
    mock.setNextResult([]);
    const { getReelJob } = await import("@/lib/db");
    expect(await getReelJob("missing")).toBeNull();
  });

  it("setReelJobStatus issues an update with coalesced output_key/error", async () => {
    mock.setNextResult([]);
    const { setReelJobStatus } = await import("@/lib/db");

    await setReelJobStatus("job-1", { status: "done", outputKey: "reels/job-1.mp4" });

    const call = mock.calls.at(-1)!;
    expect(call.text).toMatch(/update reel_jobs set/i);
    expect(call.text).toMatch(/status = /);
    expect(call.text).toMatch(/output_key = coalesce\(/i);
    expect(call.text).toMatch(/error = coalesce\(/i);
    expect(call.values).toEqual(["done", "reels/job-1.mp4", null, "job-1"]);
  });

  it("setReelJobStatus passes null outputKey/error through coalesce when omitted (preserves existing value)", async () => {
    mock.setNextResult([]);
    const { setReelJobStatus } = await import("@/lib/db");

    await setReelJobStatus("job-2", { status: "error", error: "boom" });

    const call = mock.calls.at(-1)!;
    expect(call.values).toEqual(["error", null, "boom", "job-2"]);
  });

  it("listReels selects only done rows, newest first, with limit/offset defaults", async () => {
    const rows = [{ id: "1", guest_name: "A", output_key: "reels/1.mp4", created_at: new Date() }];
    mock.setNextResult(rows);
    const { listReels } = await import("@/lib/db");

    const result = await listReels();

    expect(result).toEqual(rows);
    const call = mock.calls.at(-1)!;
    expect(call.text).toMatch(/from reel_jobs/i);
    expect(call.text).toMatch(/where status = 'done'/i);
    expect(call.text).toMatch(/order by created_at desc/i);
    expect(call.values).toEqual([100, 0]);
  });

  it("listReels honors a custom limit/offset", async () => {
    mock.setNextResult([]);
    const { listReels } = await import("@/lib/db");
    await listReels({ limit: 5, offset: 10 });
    const call = mock.calls.at(-1)!;
    expect(call.values).toEqual([5, 10]);
  });
});
