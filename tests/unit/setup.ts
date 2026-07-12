import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver; components (e.g. CollageMaker) that
// measure their container via ResizeObserver need a no-op stub to mount in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}
