import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReelMaker } from "@/components/ReelMaker";
import type { SearchResponse } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  createReel: vi.fn(),
  pollReel: vi.fn(),
}));

import { createReel, pollReel } from "@/lib/api";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

type Photo = SearchResponse["matches"][number];

function makePhoto(n: number): Photo {
  return {
    photoId: `photo-${n}`,
    similarity: 0.9,
    thumbKey: `thumb/${n}.jpg`,
    previewKey: `preview/${n}.jpg`,
    thumbUrl: `https://example.com/thumb-${n}.jpg`,
    previewUrl: `https://example.com/preview-${n}.jpg`,
  };
}

const PHOTOS: Photo[] = [makePhoto(1), makePhoto(2), makePhoto(3)];

describe("ReelMaker", () => {
  it("shows the default length and aspect", () => {
    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    expect(screen.getByTestId("reel-length-label")).toHaveTextContent("20s");
    expect(screen.getByRole("button", { name: /portrait \(4:5\)/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("moving the length slider updates the per-photo duration hint", () => {
    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    // 3 photos over 20s => 6.7s each initially.
    expect(screen.getByTestId("reel-photo-photo-1")).toHaveTextContent("6.7s");

    // The default state has only one range input (the length slider — the
    // "silent" song has no start-point trim slider), so a bare role query is
    // unambiguous even though the underlying primitive puts its accessible
    // name on the slider's wrapping div rather than the <input> itself.
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "30" } });

    expect(screen.getByTestId("reel-length-label")).toHaveTextContent("30s");
    expect(screen.getByTestId("reel-photo-photo-1")).toHaveTextContent("10.0s");
  });

  it("a remove control drops a photo from the strip", () => {
    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    expect(screen.getByTestId("reel-photo-photo-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("reel-remove-photo-2"));

    expect(screen.queryByTestId("reel-photo-photo-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("reel-photo-photo-1")).toBeInTheDocument();
    expect(screen.getByTestId("reel-photo-photo-3")).toBeInTheDocument();
  });

  it("clicking Create reel calls createReel once with the built spec", async () => {
    vi.mocked(createReel).mockResolvedValue({ jobId: "job-1" });
    vi.mocked(pollReel).mockResolvedValue({ status: "rendering" });

    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reel-create"));

    await waitFor(() => expect(createReel).toHaveBeenCalledTimes(1));
    const spec = vi.mocked(createReel).mock.calls[0][0];
    expect(spec.photoIds).toHaveLength(3);
    expect(spec.aspect).toBe("4:5");
    expect(spec.totalSeconds).toBe(20);
  });

  it("shows a video and Save/Share/Gallery controls once pollReel resolves done", async () => {
    vi.useFakeTimers();
    vi.mocked(createReel).mockResolvedValue({ jobId: "job-1" });
    vi.mocked(pollReel).mockResolvedValue({ status: "done", url: "https://example.com/reel.mp4" });

    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reel-create"));

    await vi.advanceTimersByTimeAsync(0);
    expect(createReel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByTestId("reel-video")).toHaveAttribute(
      "src",
      "https://example.com/reel.mp4",
    );
    expect(screen.getByTestId("reel-download")).toBeInTheDocument();
    expect(screen.getByTestId("reel-add-gallery")).toBeInTheDocument();
    expect(screen.getByText(/share/i)).toBeInTheDocument();
  });

  it("shows an error state and returns to an interactive editor when pollReel resolves error", async () => {
    vi.useFakeTimers();
    vi.mocked(createReel).mockResolvedValue({ jobId: "job-1" });
    vi.mocked(pollReel).mockResolvedValue({ status: "error", error: "ffmpeg exploded" });

    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reel-create"));

    await vi.advanceTimersByTimeAsync(0);
    expect(createReel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2100);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByTestId("reel-error")).toHaveTextContent("ffmpeg exploded");
    // editor is interactive again: the create button is back and enabled.
    const createButton = screen.getByTestId("reel-create");
    expect(createButton).not.toBeDisabled();
  });

  it("stops polling and shows a timeout error after ~3 minutes stuck rendering", async () => {
    vi.useFakeTimers();
    vi.mocked(createReel).mockResolvedValue({ jobId: "job-1" });
    // The render never finishes — every poll comes back "rendering".
    vi.mocked(pollReel).mockResolvedValue({ status: "rendering" });

    render(<ReelMaker photos={PHOTOS} guestName="Asha" onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("reel-create"));
    await vi.advanceTimersByTimeAsync(0);
    expect(createReel).toHaveBeenCalledTimes(1);

    // Advance well past the ~3 minute deadline, one 2s tick at a time — a
    // single huge jump doesn't reliably flush 90 chained async interval
    // callbacks under fake timers.
    const ticks = Math.ceil((3 * 60 * 1000) / 2000) + 2;
    for (let i = 0; i < ticks; i++) {
      await vi.advanceTimersByTimeAsync(2000);
    }

    expect(screen.getByTestId("reel-error")).toHaveTextContent(/taking longer than expected/i);
    const createButton = screen.getByTestId("reel-create");
    expect(createButton).not.toBeDisabled();

    const callsAtTimeout = vi.mocked(pollReel).mock.calls.length;
    // No further polling once the timeout has fired.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(pollReel).mock.calls.length).toBe(callsAtTimeout);
  });
});
