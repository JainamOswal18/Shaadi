/**
 * Device-local memory of who has looked up their photos on this browser, so a
 * returning guest doesn't have to re-enter their name + selfie every visit.
 *
 * Source of truth is localStorage (holds the small "recent people" list). The
 * active guest is mirrored into a 30-day `shaadi_guest` cookie as a redundant,
 * greet-friendly signal (readable by the client; NOT httpOnly — nothing secret
 * lives here, just a display name and a public session id).
 *
 * All functions are safe to call during SSR (they no-op / return empty when
 * `window`/`document` are unavailable).
 */

export type RememberedGuest = {
  name: string;
  sessionId: string;
  matchCount: number;
  /** epoch ms of the last search/restore for this person (for ordering). */
  at: number;
};

const LS_KEY = "shaadi:guests";
const COOKIE_NAME = "shaadi_guest";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const MAX_RECENTS = 5;

type Store = { activeId: string | null; recents: RememberedGuest[] };

const EMPTY: Store = { activeId: null, recents: [] };

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function read(): Store {
  if (!hasStorage()) return EMPTY;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Store>;
    const recents = Array.isArray(parsed.recents)
      ? parsed.recents.filter(
          (g): g is RememberedGuest =>
            !!g && typeof g.name === "string" && typeof g.sessionId === "string",
        )
      : [];
    return { activeId: parsed.activeId ?? null, recents };
  } catch {
    return EMPTY;
  }
}

function write(store: Store): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    // Storage full / disabled — degrade to in-session only.
  }
  syncCookie(activeGuest(store));
}

function syncCookie(active: RememberedGuest | null): void {
  if (typeof document === "undefined") return;
  if (active) {
    const value = encodeURIComponent(
      JSON.stringify({ name: active.name, sessionId: active.sessionId }),
    );
    document.cookie = `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } else {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

function activeGuest(store: Store): RememberedGuest | null {
  if (!store.activeId) return null;
  return store.recents.find((g) => g.sessionId === store.activeId) ?? null;
}

/** Case-insensitive name key for de-duping the same person across searches. */
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Record a successful search/restore and make this person the active guest.
 * De-dupes by name (a new search by the same person replaces their old entry)
 * and keeps the most-recent {@link MAX_RECENTS} people.
 */
export function remember(g: {
  name: string;
  sessionId: string;
  matchCount: number;
  at?: number;
}): void {
  const store = read();
  const entry: RememberedGuest = {
    name: g.name.trim(),
    sessionId: g.sessionId,
    matchCount: g.matchCount,
    at: g.at ?? Date.now(),
  };
  const key = nameKey(entry.name);
  const recents = [entry, ...store.recents.filter((r) => nameKey(r.name) !== key)].slice(
    0,
    MAX_RECENTS,
  );
  write({ activeId: entry.sessionId, recents });
}

/** The active guest for this device, or null if none / logged out. */
export function getActiveGuest(): RememberedGuest | null {
  return activeGuest(read());
}

/** All remembered people, most-recent first (includes the active one). */
export function getRecentGuests(): RememberedGuest[] {
  return read().recents;
}

/** Make a previously-remembered person active (e.g. quick-switch). No-op if absent. */
export function switchTo(sessionId: string): RememberedGuest | null {
  const store = read();
  const target = store.recents.find((g) => g.sessionId === sessionId);
  if (!target) return null;
  const recents = [target, ...store.recents.filter((g) => g.sessionId !== sessionId)];
  write({ activeId: sessionId, recents });
  return target;
}

/**
 * Log out the active guest: forget just that person (remove them from recents)
 * and clear the active pointer + cookie. Other remembered people are kept so
 * quick-switch still works on a shared device.
 */
export function logout(): void {
  const store = read();
  const activeId = store.activeId;
  const recents = activeId
    ? store.recents.filter((g) => g.sessionId !== activeId)
    : store.recents;
  write({ activeId: null, recents });
}

/** Forget everyone on this device. */
export function forgetAll(): void {
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(LS_KEY);
    } catch {
      // ignore
    }
  }
  syncCookie(null);
}
