import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createReel, fetchReels, pollReel } from "@/lib/api";
import type { ReelSpec } from "@/lib/reel";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

const SPEC: ReelSpec = {
  photoIds: ["11111111-1111-4111-8111-111111111111"],
  aspect: "4:5",
  totalSeconds: 20,
  transition: "kenburns",
  song: { id: "silent", startSec: 0 },
};

describe("reel client api", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("createReel", () => {
    it("POSTs the spec as JSON to /api/reel and returns {jobId}", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(202, { jobId: "job-1" }));

      const res = await createReel(SPEC);

      expect(res).toEqual({ jobId: "job-1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/reel");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(JSON.parse(init.body)).toEqual(SPEC);
    });

    it("throws an ApiError with the mirrored code on a non-ok response", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: "maintenance" }));

      try {
        await createReel(SPEC);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(503);
        expect((err as ApiError).code).toBe("maintenance");
      }
    });
  });

  describe("pollReel", () => {
    it("GETs /api/reel?jobId=... and returns the status body", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "rendering" }));

      const res = await pollReel("job-1");

      expect(res).toEqual({ status: "rendering" });
      expect(fetchMock).toHaveBeenCalledWith("/api/reel?jobId=job-1");
    });

    it("URL-encodes the jobId", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: "done", url: "https://x" }));

      await pollReel("a/b c");

      expect(fetchMock).toHaveBeenCalledWith("/api/reel?jobId=a%2Fb%20c");
    });
  });

  describe("fetchReels", () => {
    it("GETs /api/admin/reels and returns the reels list", async () => {
      const reels = [
        { id: "r1", guest: "Asha", url: "https://signed/1.mp4", createdAt: "2026-07-01T00:00:00Z" },
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { reels }));

      const res = await fetchReels();

      expect(res).toEqual({ reels });
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/reels");
    });
  });
});
