// @vitest-environment node
//
// Pure-logic tests for the reel-specific rate limiter. Mirrors
// tests/unit/reel_jobs.test.ts: the `postgres` package is fully mocked so
// `@/lib/db`'s `sql` tagged template just records the query text +
// interpolated values instead of opening a real connection. This never
// touches the live DB that `DATABASE_URL` points at.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("checkReelRateLimit (mocked postgres — no real DB connection)", () => {
  let mock: ReturnType<typeof makeSqlMock>;

  beforeEach(() => {
    vi.resetModules();
    mock = makeSqlMock();
    vi.doMock("postgres", () => ({ default: vi.fn(() => mock.sqlTag) }));
  });

  afterEach(() => {
    vi.doUnmock("postgres");
  });

  it("allows a request with no attributable IP (fail open)", async () => {
    const { checkReelRateLimit } = await import("@/lib/ratelimit");
    expect(await checkReelRateLimit(null)).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });

  it("queries reel_jobs (not search_sessions) within a trailing 10-minute window", async () => {
    mock.setNextResult([{ count: "0" }]);
    const { checkReelRateLimit } = await import("@/lib/ratelimit");

    await checkReelRateLimit("1.2.3.4");

    const call = mock.calls.at(-1)!;
    expect(call.text).toMatch(/from reel_jobs/i);
    expect(call.text).toMatch(/created_at > now\(\) - interval '10 minutes'/i);
    expect(call.values).toEqual(["1.2.3.4"]);
  });

  it("allows the request when the IP is under the cap", async () => {
    mock.setNextResult([{ count: "4" }]);
    const { checkReelRateLimit } = await import("@/lib/ratelimit");
    expect(await checkReelRateLimit("1.2.3.4")).toBe(true);
  });

  it("rejects the request once the IP is at/over the cap", async () => {
    mock.setNextResult([{ count: "5" }]);
    const { checkReelRateLimit } = await import("@/lib/ratelimit");
    expect(await checkReelRateLimit("1.2.3.4")).toBe(false);
  });

  it("rejects when well over the cap", async () => {
    mock.setNextResult([{ count: "42" }]);
    const { checkReelRateLimit } = await import("@/lib/ratelimit");
    expect(await checkReelRateLimit("1.2.3.4")).toBe(false);
  });
});
