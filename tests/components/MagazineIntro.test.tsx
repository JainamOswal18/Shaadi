import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MagazineIntro, INTRO_SEEN_KEY } from "@/components/MagazineIntro";

afterEach(cleanup);

// This project's jsdom environment does not expose a functional
// window.localStorage (see tests/unit/guest-store.test.ts), so we install a
// minimal Map-backed Storage the same way, matching real-browser semantics.
function installStorageShim(): void {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}

describe("MagazineIntro", () => {
  beforeEach(() => {
    installStorageShim();
    localStorage.clear();
  });

  it("has no Devanagari kicker", () => {
    render(<MagazineIntro onDone={vi.fn()} />);
    expect(screen.queryByText(/शादी|जीना/)).not.toBeInTheDocument();
  });

  it("Skip marks the intro seen and calls onDone", () => {
    const onDone = vi.fn();
    render(<MagazineIntro onDone={onDone} />);
    fireEvent.click(screen.getByTestId("intro-skip"));
    expect(onDone).toHaveBeenCalled();
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe("1");
  });
});
