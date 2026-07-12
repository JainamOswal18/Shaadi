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
