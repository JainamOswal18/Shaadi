import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SelfieCapture } from "@/components/SelfieCapture";

afterEach(cleanup);

describe("SelfieCapture tray", () => {
  it("opens a tray with camera and gallery options when the box is tapped", () => {
    render(<SelfieCapture onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("selfie-box"));
    expect(screen.getByTestId("tray-camera")).toBeInTheDocument();
    expect(screen.getByTestId("tray-gallery")).toBeInTheDocument();
  });

  it("gallery option triggers the file input", () => {
    render(<SelfieCapture onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("selfie-box"));
    const input = screen.getByLabelText("Upload a selfie photo") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByTestId("tray-gallery"));
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe("SelfieCapture camera restart", () => {
  function fakeStream() {
    const track = { stop: vi.fn(), kind: "video" };
    const stream = {
      getTracks: () => [track],
    } as unknown as MediaStream;
    return { stream, track };
  }

  it("restart control tears down the current stream and re-requests the camera", async () => {
    vi.useFakeTimers();
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    // jsdom video elements don't implement play(); stub it so startCamera's
    // requestAnimationFrame callback doesn't throw.
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    render(<SelfieCapture onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("selfie-box"));
    fireEvent.click(screen.getByTestId("tray-camera"));

    // flush the getUserMedia() promise and the requestAnimationFrame callback
    // that attaches the stream (jsdom implements rAF via the faked setTimeout)
    await vi.advanceTimersByTimeAsync(50);

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const restartButton = screen.getByTestId("selfie-restart");
    fireEvent.click(restartButton);

    expect(track.stop).toHaveBeenCalled();

    // flush the ~300ms teardown delay before startCamera() re-runs
    await vi.advanceTimersByTimeAsync(500);

    expect(getUserMedia).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
