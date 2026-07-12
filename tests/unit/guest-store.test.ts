// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetAll,
  getActiveGuest,
  getRecentGuests,
  logout,
  remember,
  switchTo,
} from "@/lib/guest-store";

// Device-memory of remembered guests, backed by localStorage (+ a mirrored
// cookie). Verifies the "don't log in again" contract: remember → active,
// de-dupe by name, quick-switch, and log out forgetting just the active person.

// This project's jsdom environment does not expose window.localStorage, so we
// install a minimal Map-backed Storage (real browsers always have one). We also
// shim document.cookie with a tiny store since jsdom's cookie jar ignores the
// `Max-Age`/`SameSite` attributes we set and won't expire on `Max-Age=0`.
function installStorageShims(): void {
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

  const jar = new Map<string, string>();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () =>
      Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    set: (raw: string) => {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const maxAge = attrs
        .map((a) => a.trim().toLowerCase())
        .find((a) => a.startsWith("max-age="));
      if (maxAge === "max-age=0") jar.delete(name);
      else jar.set(name, value);
    },
  });
}

function cookieValue(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)shaadi_guest=([^;]*)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

describe("guest-store", () => {
  beforeEach(() => {
    installStorageShims();
    forgetAll();
  });

  it("remembers a guest and makes them active + writes the cookie", () => {
    remember({ name: "Priya", sessionId: "s1", matchCount: 12 });
    const active = getActiveGuest();
    expect(active?.name).toBe("Priya");
    expect(active?.sessionId).toBe("s1");
    expect(active?.matchCount).toBe(12);
    expect(cookieValue()).toContain("s1");
    expect(cookieValue()).toContain("Priya");
  });

  it("de-dupes by case-insensitive name, keeping the newest session", () => {
    remember({ name: "Priya", sessionId: "s1", matchCount: 3 });
    remember({ name: "  priya ", sessionId: "s2", matchCount: 9 });
    const recents = getRecentGuests();
    expect(recents).toHaveLength(1);
    expect(recents[0]?.sessionId).toBe("s2");
    expect(getActiveGuest()?.sessionId).toBe("s2");
  });

  it("keeps distinct people most-recent-first and caps at 5", () => {
    for (const [i, n] of ["A", "B", "C", "D", "E", "F"].entries()) {
      remember({ name: n, sessionId: `s${i}`, matchCount: i });
    }
    const recents = getRecentGuests();
    expect(recents).toHaveLength(5);
    expect(recents[0]?.name).toBe("F"); // newest first
    expect(recents.map((g) => g.name)).not.toContain("A"); // oldest evicted
  });

  it("switchTo makes a prior person active without dropping others", () => {
    remember({ name: "A", sessionId: "sa", matchCount: 1 });
    remember({ name: "B", sessionId: "sb", matchCount: 2 });
    expect(getActiveGuest()?.sessionId).toBe("sb");
    const switched = switchTo("sa");
    expect(switched?.sessionId).toBe("sa");
    expect(getActiveGuest()?.sessionId).toBe("sa");
    expect(getRecentGuests()).toHaveLength(2);
    expect(cookieValue()).toContain("sa");
  });

  it("switchTo is a no-op for an unknown session", () => {
    remember({ name: "A", sessionId: "sa", matchCount: 1 });
    expect(switchTo("nope")).toBeNull();
    expect(getActiveGuest()?.sessionId).toBe("sa");
  });

  it("logout forgets only the active person, clears active + cookie", () => {
    remember({ name: "A", sessionId: "sa", matchCount: 1 });
    remember({ name: "B", sessionId: "sb", matchCount: 2 }); // active
    logout();
    expect(getActiveGuest()).toBeNull();
    expect(cookieValue()).toBeNull();
    const recents = getRecentGuests();
    expect(recents.map((g) => g.sessionId)).toEqual(["sa"]); // B forgotten, A kept
  });

  it("forgetAll clears everyone", () => {
    remember({ name: "A", sessionId: "sa", matchCount: 1 });
    forgetAll();
    expect(getRecentGuests()).toHaveLength(0);
    expect(getActiveGuest()).toBeNull();
    expect(cookieValue()).toBeNull();
  });
});
