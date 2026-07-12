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
