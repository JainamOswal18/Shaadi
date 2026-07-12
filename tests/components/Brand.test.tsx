import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Brand } from "@/components/Brand";

describe("Brand", () => {
  it("renders the JEENA wordmark with no Devanagari", () => {
    render(<Brand href={null} />);
    expect(screen.getByText("Jeena")).toBeInTheDocument();
    expect(screen.queryByText("शादी")).not.toBeInTheDocument();
  });

  it("shows the est. subline only at large size", () => {
    const { rerender } = render(<Brand href={null} size="lg" withEst />);
    expect(screen.getByText(/Est\. 2026/)).toBeInTheDocument();
    rerender(<Brand href={null} size="sm" />);
    expect(screen.queryByText(/Est\. 2026/)).not.toBeInTheDocument();
  });
});
