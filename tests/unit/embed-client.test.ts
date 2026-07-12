// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbedResponse } from "@/lib/types";

// Loaded fresh per test after we've set/cleared EMBED_FN_URL, since the client
// reads it via loadEnv() (which caches) — we re-import with a reset module
// registry so each test gets a fresh env read.
async function importClient() {
  return import("@/lib/embed-client");
}

function makeFetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

const FIXTURE: EmbedResponse = {
  faces: [
    // Small face: 10x10 = 100 area.
    { embedding: [0.1, 0.2, 0.3], bbox: [0, 0, 10, 10], det_score: 0.9 },
    // Large face: 100x100 = 10_000 area — should win.
    { embedding: [0.4, 0.5, 0.6], bbox: [50, 50, 150, 150], det_score: 0.8 },
    // Medium face: 20x20 = 400 area.
    { embedding: [0.7, 0.8, 0.9], bbox: [200, 200, 220, 220], det_score: 0.7 },
  ],
};

describe("largestFace", () => {
  it("returns the embedding of the face with the largest bbox area", async () => {
    const { largestFace } = await importClient();
    expect(largestFace(FIXTURE)).toEqual([0.4, 0.5, 0.6]);
  });

  it("returns null when there are no faces", async () => {
    const { largestFace } = await importClient();
    expect(largestFace({ faces: [] })).toBeNull();
  });
});

describe("embedImage", () => {
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

  it("POSTs the raw bytes to the configured EMBED_FN_URL and parses the response", async () => {
    vi.stubEnv("EMBED_FN_URL", "https://embed.example.com/api/embed");
    const responseBody: EmbedResponse = {
      faces: [{ embedding: [1, 2, 3], bbox: [0, 0, 5, 5], det_score: 0.5 }],
    };
    fetchMock.mockResolvedValueOnce(makeFetchResponse(responseBody));

    const { embedImage } = await importClient();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    const result = await embedImage(bytes);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://embed.example.com/api/embed");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(bytes);
    expect(result).toEqual(responseBody);
  });

  it("defaults to the local dev URL when EMBED_FN_URL is unset", async () => {
    // Passing undefined deletes the var, exercising the ?? fallback.
    vi.stubEnv("EMBED_FN_URL", undefined as unknown as string);
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ faces: [] }));

    const { embedImage } = await importClient();
    await embedImage(new Uint8Array([1, 2, 3]));

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/embed");
  });

  it("sends an Authorization: Bearer header when EMBED_API_KEY is set", async () => {
    vi.stubEnv("EMBED_FN_URL", "https://embed.example.com/api/embed");
    vi.stubEnv("EMBED_API_KEY", "s3cr3t");
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ faces: [] }));

    const { embedImage } = await importClient();
    await embedImage(Buffer.from([1]));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer s3cr3t");
  });

  it("omits the Authorization header when EMBED_API_KEY is unset", async () => {
    vi.stubEnv("EMBED_FN_URL", "https://embed.example.com/api/embed");
    vi.stubEnv("EMBED_API_KEY", undefined as unknown as string);
    fetchMock.mockResolvedValueOnce(makeFetchResponse({ faces: [] }));

    const { embedImage } = await importClient();
    await embedImage(Buffer.from([1]));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
  });

  it("throws when the function responds with a non-ok status", async () => {
    vi.stubEnv("EMBED_FN_URL", "https://embed.example.com/api/embed");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "empty body" }),
    } as Response);

    const { embedImage } = await importClient();
    await expect(embedImage(Buffer.from([1]))).rejects.toThrow();
  });
});
