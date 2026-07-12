// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReelDispatchPayload } from "@/lib/reel-client";

// Loaded fresh per test after we've stubbed env, since the client reads
// REEL_FN_URL/EMBED_API_KEY via loadEnv() (which caches) — mirrors
// tests/unit/embed-client.test.ts.
async function importClient() {
  return import("@/lib/reel-client");
}

function makeFetchResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? {},
  } as Response;
}

const PAYLOAD: ReelDispatchPayload = {
  jobId: "11111111-1111-4111-8111-111111111111",
  aspect: "4:5",
  width: 1080,
  height: 1350,
  totalSeconds: 20,
  transition: "kenburns",
  frames: [{ url: "https://example.com/a.jpg", seconds: 10 }],
  audio: { url: null, startSec: 0 },
  outputKey: "reels/11111111-1111-4111-8111-111111111111.mp4",
  callbackUrl: "https://app.example.com/api/reel/callback",
};

describe("dispatchReel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends an Authorization: Bearer header + JSON body when EMBED_API_KEY is set", async () => {
    vi.stubEnv("REEL_FN_URL", "https://render.example.com/reel");
    vi.stubEnv("EMBED_API_KEY", "s3cr3t");
    fetchMock.mockResolvedValueOnce(makeFetchResponse(202));

    const { dispatchReel } = await importClient();
    await dispatchReel(PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://render.example.com/reel");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer s3cr3t");
    expect(JSON.parse(init.body)).toEqual({ ...PAYLOAD, jobId: PAYLOAD.jobId });
  });

  it("omits the Authorization header when EMBED_API_KEY is unset", async () => {
    vi.stubEnv("REEL_FN_URL", "https://render.example.com/reel");
    vi.stubEnv("EMBED_API_KEY", undefined as unknown as string);
    fetchMock.mockResolvedValueOnce(makeFetchResponse(202));

    const { dispatchReel } = await importClient();
    await dispatchReel(PAYLOAD);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
  });

  it("defaults to the local dev URL when REEL_FN_URL is unset", async () => {
    vi.stubEnv("REEL_FN_URL", undefined as unknown as string);
    fetchMock.mockResolvedValueOnce(makeFetchResponse(202));

    const { dispatchReel } = await importClient();
    await dispatchReel(PAYLOAD);

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/reel");
  });

  it("resolves cleanly on a 202 response", async () => {
    vi.stubEnv("REEL_FN_URL", "https://render.example.com/reel");
    fetchMock.mockResolvedValueOnce(makeFetchResponse(202));

    const { dispatchReel } = await importClient();
    await expect(dispatchReel(PAYLOAD)).resolves.toBeUndefined();
  });

  it("throws with the status + detail on a 500 {error} response", async () => {
    vi.stubEnv("REEL_FN_URL", "https://render.example.com/reel");
    fetchMock.mockResolvedValueOnce(makeFetchResponse(500, { error: "ffmpeg missing" }));

    const { dispatchReel } = await importClient();
    await expect(dispatchReel(PAYLOAD)).rejects.toThrow(/500.*ffmpeg missing/);
  });

  it("surfaces a clean error when fetch itself throws/aborts", async () => {
    vi.stubEnv("REEL_FN_URL", "https://render.example.com/reel");
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const { dispatchReel } = await importClient();
    await expect(dispatchReel(PAYLOAD)).rejects.toThrow(/network down/);
  });
});
