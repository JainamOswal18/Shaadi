import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StickerMotif } from "@/components/collage/StickerMotif";

describe("StickerMotif", () => {
  it("renders an svg for garland, phera, and doli", () => {
    for (const id of ["garland", "phera", "doli"] as const) {
      const { container } = render(<StickerMotif id={id} color="#5A1F2B" />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("colours the sticker with the given color prop", () => {
    const { container } = render(<StickerMotif id="phera" color="#C9A24B" />);
    const svg = container.querySelector("svg")!;
    expect(svg.innerHTML).toContain("#C9A24B");
  });
});
