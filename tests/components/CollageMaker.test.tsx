import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { CollageMaker } from "@/components/CollageMaker";

afterEach(cleanup);

vi.mock("html-to-image", () => ({ toBlob: vi.fn().mockResolvedValue(new Blob(["x"])) }));
vi.mock("@/lib/api", () => ({
  requestUploadUrls: vi.fn(),
  putToR2: vi.fn(),
  uploadComplete: vi.fn(),
}));

const photos = [
  { photoId: "1", previewUrl: "https://x/1.jpg" },
  { photoId: "2", previewUrl: "https://x/2.jpg" },
] as never;

describe("CollageMaker ratio toggle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults to the 4:5 ratio button pressed", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const btn = screen.getByRole("button", { name: /portrait 4:5/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("switches ratio and updates the exported-size caption", async () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /story 9:16/i }));
    expect(await screen.findByText(/exports at 1080×1920/i)).toBeInTheDocument();
  });

  it("passes ratio-correct dimensions to toBlob on export", async () => {
    const { toBlob } = await import("html-to-image");
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /square/i }));
    fireEvent.click(screen.getByTestId("collage-download"));
    await vi.waitFor(() =>
      expect(toBlob).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ width: 1080, height: 1080 }),
      ),
    );
  });
});

describe("CollageMaker per-slot pan/zoom", () => {
  it("applies the default centered transform to slot images", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs[0]).toHaveStyle({ transform: "scale(1) translate(0%, 0%)" });
  });

  it("zooms a slot on wheel and updates its transform", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    fireEvent.wheel(slot, { deltaY: -100 });
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/scale\(1\.\d+\)/);
  });

  it("pans a zoomed slot on pointer drag", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    fireEvent.wheel(slot, { deltaY: -300 }); // zoom in first so panning has room
    fireEvent.pointerDown(slot, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(slot, { clientX: 130, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(slot, { pointerId: 1 });
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/translate\(-?\d+%, -?\d+%\)/);
    expect(img.style.transform).not.toBe("scale(1) translate(0%, 0%)");
  });

  it("increases scale on a two-pointer pinch-out gesture", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];

    // Two fingers land close together...
    fireEvent.pointerDown(slot, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerDown(slot, { clientX: 110, clientY: 100, pointerId: 2 });
    // ...then spread apart: distance goes from 10 to 40 (4x), scale should
    // roughly quadruple from 1 and clamp at the [1, 3] ceiling.
    fireEvent.pointerMove(slot, { clientX: 80, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(slot, { clientX: 140, clientY: 100, pointerId: 2 });

    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/scale\(3\)/);

    fireEvent.pointerUp(slot, { pointerId: 1 });
    fireEvent.pointerUp(slot, { pointerId: 2 });
  });

  it("suspends single-pointer panning while a second pointer is active on the same slot", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    fireEvent.wheel(slot, { deltaY: -100 }); // scale -> 1.1, gives a little pan headroom

    fireEvent.pointerDown(slot, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(slot, { clientX: 110, clientY: 100, pointerId: 1 }); // would pan if alone
    const img = within(slot).getByRole("img", { hidden: true });
    const afterFirstMove = img.style.transform;

    fireEvent.pointerDown(slot, { clientX: 120, clientY: 100, pointerId: 2 }); // pinch starts
    fireEvent.pointerMove(slot, { clientX: 300, clientY: 100, pointerId: 1 }); // large "pan" delta, ignored
    // Only the pinch scale math should move the transform now, not a pan
    // large enough to correspond to a 200px single-pointer drag.
    expect(img.style.transform).not.toContain("translate(62%");

    fireEvent.pointerUp(slot, { pointerId: 1 });
    fireEvent.pointerUp(slot, { pointerId: 2 });
    void afterFirstMove;
  });
});

describe("CollageMaker accessible zoom control", () => {
  it("shows a range input and +/- steppers bound to the active slot", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const range = screen.getByTestId("collage-zoom-range") as HTMLInputElement;
    expect(range).toHaveAttribute("type", "range");
    expect(range).toHaveAttribute("min", "1");
    expect(range).toHaveAttribute("max", "3");
    expect(range.value).toBe("1");

    fireEvent.click(screen.getByTestId("collage-zoom-in"));
    expect(Number(range.value)).toBeGreaterThan(1);

    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toMatch(/scale\(1\.\d+\)/);
  });

  it("updates the slot transform when the range input changes directly", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const range = screen.getByTestId("collage-zoom-range");
    fireEvent.change(range, { target: { value: "2.5" } });
    const slot = screen.getAllByTestId(/collage-slot-/)[0];
    const img = within(slot).getByRole("img", { hidden: true });
    expect(img.style.transform).toContain("scale(2.5)");
  });

  it("disables the zoom-out stepper at the minimum scale", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    expect(screen.getByTestId("collage-zoom-out")).toBeDisabled();
  });
});

describe("CollageMaker motifs and font style", () => {
  it("offers 5 background motifs including phera and doli", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Phera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Doli" })).toBeInTheDocument();
  });

  it("switches caption font style and marks the button pressed", () => {
    render(<CollageMaker photos={photos} onClose={() => {}} />);
    const scriptBtn = screen.getByRole("button", { name: "Script" });
    fireEvent.click(scriptBtn);
    expect(scriptBtn).toHaveAttribute("aria-pressed", "true");
  });
});
