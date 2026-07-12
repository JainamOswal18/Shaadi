// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the real /api/reel routes (create/dispatch, status, callback) end
// to end against an isolated schema (real Postgres DDL), with only the two
// external side effects stubbed: the render-service dispatch (mocked module,
// mirroring how search.route.test.ts mocks embed-client) and R2 object
// storage (aws-sdk-client-mock, for presignGet). Nothing touches production
// data, real object storage, or the live EC2 render service.
const TEST_SCHEMA = "shaadi_test_reel_route";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

vi.mock("@/lib/reel-client", () => ({ dispatchReel: vi.fn() }));

const s3mock = mockClient(S3Client as unknown as new (...args: unknown[]) => S3Client);

// Loaded fresh in beforeAll, after DB_SCHEMA is set.
let sql: typeof import("@/lib/db").sql;
let insertPhoto: typeof import("@/lib/db").insertPhoto;
let getReelJob: typeof import("@/lib/db").getReelJob;
let setReelJobStatus: typeof import("@/lib/db").setReelJobStatus;
let updateSettings: typeof import("@/lib/db").updateSettings;
let POST: typeof import("@/app/api/reel/route").POST;
let GET: typeof import("@/app/api/reel/route").GET;
let dispatchReel: ReturnType<typeof vi.fn>;

// Throwaway admin client (default search_path) for schema create/drop.
const admin = postgres(process.env.DATABASE_URL as string);

let photoId1: string;
let photoId2: string;

function validSpec(photoIds: string[]) {
  return {
    photoIds,
    aspect: "4:5",
    totalSeconds: 20,
    transition: "kenburns",
    song: { id: "silent", startSec: 0 },
  };
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api/reel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(jobId?: string): Request {
  const url = jobId
    ? `http://localhost/api/reel?jobId=${encodeURIComponent(jobId)}`
    : "http://localhost/api/reel";
  return new Request(url);
}

beforeAll(async () => {
  await admin`create schema if not exists ${admin(TEST_SCHEMA)}`;

  process.env.DB_SCHEMA = TEST_SCHEMA;
  vi.resetModules();

  const db = await import("@/lib/db");
  sql = db.sql;
  insertPhoto = db.insertPhoto;
  getReelJob = db.getReelJob;
  setReelJobStatus = db.setReelJobStatus;
  updateSettings = db.updateSettings;

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }

  const reelClient = await import("@/lib/reel-client");
  dispatchReel = reelClient.dispatchReel as unknown as ReturnType<typeof vi.fn>;

  POST = (await import("@/app/api/reel/route")).POST;
  GET = (await import("@/app/api/reel/route")).GET;

  const p1 = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/1.jpg",
    previewKey: "preview/1.jpg",
    thumbKey: "thumb/1.jpg",
  });
  const p2 = await insertPhoto({
    source: "ingest",
    contentHash: randomUUID(),
    originalKey: "orig/2.jpg",
    previewKey: "preview/2.jpg",
    thumbKey: "thumb/2.jpg",
  });
  photoId1 = p1.id;
  photoId2 = p2.id;
}, 60_000);

afterAll(async () => {
  await admin`drop schema if exists ${admin(TEST_SCHEMA)} cascade`;
  await admin.end();
  if (sql) await sql.end();
  s3mock.restore();
});

beforeEach(() => {
  s3mock.reset();
  dispatchReel.mockReset();
  dispatchReel.mockResolvedValue(undefined);
});

afterEach(async () => {
  await updateSettings({ killSwitch: false });
});

describe("POST /api/reel (integration, isolated schema)", () => {
  it("returns 503 when the kill switch is on", async () => {
    await updateSettings({ killSwitch: true });
    const res = await POST(postReq(validSpec([photoId1])));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect(dispatchReel).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body (missing song, totalSeconds too high)", async () => {
    const res = await POST(
      postReq({ photoIds: [photoId1], totalSeconds: 61 }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("returns 400 for an unknown photo id", async () => {
    const res = await POST(postReq(validSpec([randomUUID()])));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_photo" });
  });

  it("happy path: 202 {jobId}, dispatches with resolved preview frames, marks the job rendering", async () => {
    const res = await POST(postReq(validSpec([photoId1, photoId2])));
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);

    expect(dispatchReel).toHaveBeenCalledTimes(1);
    const payload = dispatchReel.mock.calls[0][0];
    expect(payload.frames).toHaveLength(2);
    expect(payload.frames[0].url).toContain("preview/1.jpg");
    expect(payload.frames[1].url).toContain("preview/2.jpg");
    expect(payload.outputKey).toBe(`reels/${body.jobId}.mp4`);
    expect(payload.callbackUrl).toMatch(/\/api\/reel\/callback$/);

    const job = await getReelJob(body.jobId);
    expect(job?.status).toBe("rendering");
  });

  it("dispatch failure: 502 {error} and the job row is marked error", async () => {
    dispatchReel.mockRejectedValueOnce(new Error("box unreachable"));
    const res = await POST(postReq(validSpec([photoId1])));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "render_unavailable" });

    // Find the job that was just created (schema is otherwise empty of errors).
    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from reel_jobs where status = 'error' order by created_at desc limit 1`;
    expect(rows[0]?.status).toBe("error");
  });
});

describe("GET /api/reel (integration, isolated schema)", () => {
  it("returns {status:'rendering'} with no url for a rendering job", async () => {
    const res = await POST(postReq(validSpec([photoId1])));
    const { jobId } = (await res.json()) as { jobId: string };

    const statusRes = await GET(getReq(jobId));
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { status: string; url?: string };
    expect(body.status).toBe("rendering");
    expect(body.url).toBeUndefined();
  });

  it("returns {status:'done', url} once the job is marked done", async () => {
    const res = await POST(postReq(validSpec([photoId1])));
    const { jobId } = (await res.json()) as { jobId: string };
    await setReelJobStatus(jobId, { status: "done", outputKey: `reels/${jobId}.mp4` });

    const statusRes = await GET(getReq(jobId));
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { status: string; url?: string };
    expect(body.status).toBe("done");
    expect(typeof body.url).toBe("string");
    expect(body.url).toBeTruthy();
  });

  it("returns 400 for a bad/missing jobId", async () => {
    expect((await GET(getReq())).status).toBe(400);
    expect((await GET(getReq("not-a-uuid"))).status).toBe(400);
  });

  it("returns 404 for an unknown jobId", async () => {
    const res = await GET(getReq(randomUUID()));
    expect(res.status).toBe(404);
  });
});
