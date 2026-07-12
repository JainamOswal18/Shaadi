import { http, HttpResponse } from "msw";
import type {
  ConfigResponse,
  SearchResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  AdminSettings,
} from "@/lib/types";

/** Mock admin password used only by MSW in dev/e2e (real API uses ADMIN_PASSWORD). */
export const MOCK_ADMIN_PASSWORD = "shaadi-admin";
/** Mock shared guest passcode used only by MSW in dev/e2e when passcode_enabled is true. */
export const MOCK_PASSCODE = "1234-mandap";
const ADMIN_COOKIE = "shaadi_admin=ok";

/** Deterministic, offline warm-toned SVG placeholder (no external network). */
function placeholder(seed: number, w: number, h: number, label = false): string {
  const hues = [28, 12, 44, 350, 20, 60];
  const hue = hues[seed % hues.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='hsl(${hue} 70% 62%)'/>
      <stop offset='1' stop-color='hsl(${(hue + 24) % 360} 65% 42%)'/>
    </linearGradient></defs>
    <rect width='${w}' height='${h}' fill='url(#g)'/>
    <circle cx='${w * 0.5}' cy='${h * 0.42}' r='${Math.min(w, h) * 0.16}' fill='hsl(45 90% 70% / 0.5)'/>
    ${label ? `<text x='50%' y='92%' fill='white' font-family='sans-serif' font-size='${Math.round(w / 12)}' text-anchor='middle' opacity='0.85'>#${seed + 1}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function makeMatches(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    photoId: `photo-${i + 1}`,
    similarity: Number((0.92 - i * 0.03).toFixed(3)),
    thumbKey: `thumbs/photo-${i + 1}.webp`,
    previewKey: `previews/photo-${i + 1}.webp`,
    thumbUrl: placeholder(i, 400, 300 + ((i % 3) * 120), true),
    previewUrl: placeholder(i, 1200, 900 + ((i % 3) * 240), true),
  }));
}

/**
 * e2e specs can seed the initial admin settings before any of the page's own
 * scripts run, via `page.addInitScript(() => { window.__E2E_SETTINGS__ = {...} })`.
 * This lets a single hard navigation start already in "maintenance" or
 * "passcode required" mode without fragile same-session admin-login
 * choreography (a real `page.goto` reloads the document and resets this
 * module's state, so settings can't be flipped via the admin UI mid-test and
 * carried over to a guest-facing navigation). Never set outside Playwright —
 * has no effect in real dev/prod use.
 */
function initialSettings(): AdminSettings {
  const defaults: AdminSettings = {
    match_threshold: 0.35,
    passcode_enabled: false,
    kill_switch: false,
  };
  if (typeof window === "undefined") return defaults;
  const seed = (window as unknown as { __E2E_SETTINGS__?: Partial<AdminSettings> })
    .__E2E_SETTINGS__;
  return seed ? { ...defaults, ...seed } : defaults;
}

/**
 * Whether POST /api/search should simulate the embed compute being
 * unreachable (a real 502 {error:"embed_unavailable"}, per src/lib/embed-client.ts
 * + src/app/api/search/route.ts). Not part of AdminSettings — it isn't a real
 * per-event admin toggle, just a condition e2e specs seed the same way
 * (`window.__E2E_SETTINGS__.embed_unavailable`).
 */
function initialEmbedUnavailable(): boolean {
  if (typeof window === "undefined") return false;
  const seed = (window as unknown as { __E2E_SETTINGS__?: { embed_unavailable?: boolean } })
    .__E2E_SETTINGS__;
  return seed?.embed_unavailable ?? false;
}

/** In-memory mutable state for admin flows. */
const state = {
  authed: false,
  settings: initialSettings(),
  embedUnavailable: initialEmbedUnavailable(),
  quota: { photos: 20, videos: 5 },
  // `id` mirrors the real photo/media row id (required by POST /api/admin/delete);
  // `guest` is null for the one ingest-sourced item, matching the real gallery.
  media: makeMatches(8).map((m, i) => ({
    id: m.photoId,
    kind: i % 5 === 0 ? "video" : "photo",
    guest: i === 7 ? null : ["Aarav", "Diya", "Kabir", "Meera"][i % 4],
    thumbUrl: m.thumbUrl,
    uploadedAt: new Date(Date.now() - i * 3600_000).toISOString(),
  })),
  logs: Array.from({ length: 46 }, (_, i) => ({
    id: `log-${i + 1}`,
    type: (["search", "upload", "download"] as const)[i % 3],
    guest: ["Aarav", "Diya", "Kabir", "Meera", "Rohan"][i % 5],
    detail:
      i % 3 === 0
        ? `${3 + (i % 7)} matches`
        : i % 3 === 1
          ? `${1 + (i % 4)} files`
          : `photo-${1 + (i % 8)}`,
    at: new Date(Date.now() - i * 1800_000).toISOString(),
  })),
  // Admin "Who searched" feed — fake rows with data-URI selfies so the view
  // renders fully offline (no real R2 signed URL needed in dev/e2e).
  searches: Array.from({ length: 24 }, (_, i) => ({
    id: `search-${i + 1}`,
    guestName: i % 6 === 5 ? null : ["Aarav", "Diya", "Kabir", "Meera", "Rohan"][i % 5],
    at: new Date(Date.now() - i * 2100_000).toISOString(),
    matchCount: i % 6 === 5 ? 0 : 1 + (i % 9),
    selfieUrl: placeholder(i, 96, 96),
  })),
};

const isAuthed = (req: Request) =>
  state.authed || (req.headers.get("cookie") ?? "").includes(ADMIN_COOKIE);

export const handlers = [
  // ---- Guest config bootstrap ----
  http.get("/api/config", () => {
    const response: ConfigResponse = { passcodeRequired: state.settings.passcode_enabled };
    return HttpResponse.json(response);
  }),

  // ---- Guest search ----
  http.post("/api/search", async ({ request }) => {
    // Mirrors the real /api/search: kill switch short-circuits everything with
    // a real 503, and (when enabled) a missing/wrong passcode is a real 403 —
    // both before any "search" work runs.
    if (state.settings.kill_switch) {
      return HttpResponse.json({ error: "maintenance" }, { status: 503 });
    }
    if (state.settings.passcode_enabled) {
      const form = await request.formData();
      const passcode = form.get("passcode");
      if (passcode !== MOCK_PASSCODE) {
        return HttpResponse.json({ error: "passcode" }, { status: 403 });
      }
    }
    // Mirrors the real /api/search: the embed function call is the last thing
    // that can fail before a search actually runs, surfaced as a real 502.
    if (state.embedUnavailable) {
      return HttpResponse.json({ error: "embed_unavailable" }, { status: 502 });
    }
    await new Promise((r) => setTimeout(r, 350));
    const response: SearchResponse = {
      sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
      matches: makeMatches(5),
    };
    return HttpResponse.json(response);
  }),

  http.get("/api/download", ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("photoId") ?? "photo";
    return new HttpResponse(new Blob(["mock-original-image"]), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${id}.jpg"`,
      },
    });
  }),

  http.get("/api/download-zip", ({ request }) => {
    const url = new URL(request.url);
    const sid = url.searchParams.get("sessionId") ?? "session";
    return new HttpResponse(new Blob(["mock-zip-archive"]), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="shaadi-${sid}.zip"`,
      },
    });
  }),

  // ---- Upload ----
  http.post("/api/upload-url", async ({ request }) => {
    const body = (await request.json()) as UploadUrlRequest;
    const grants = body.files.map((f) => ({
      name: f.name,
      key: `originals/${body.sessionId}/${f.name}`,
      putUrl: `https://mock-r2.shaadi.test/put/${encodeURIComponent(f.name)}`,
    }));
    const photos = body.files.filter((f) => f.kind === "photo").length;
    const videos = body.files.filter((f) => f.kind === "video").length;
    state.quota.photos = Math.max(0, state.quota.photos - photos);
    state.quota.videos = Math.max(0, state.quota.videos - videos);
    const response: UploadUrlResponse = {
      grants,
      remaining: { photos: state.quota.photos, videos: state.quota.videos },
    };
    return HttpResponse.json(response);
  }),

  http.put("https://mock-r2.shaadi.test/put/*", async () => {
    await new Promise((r) => setTimeout(r, 250));
    return new HttpResponse(null, { status: 200, headers: { etag: '"mock-etag"' } });
  }),

  http.post("/api/upload-complete", async () => {
    return HttpResponse.json({ ok: true });
  }),

  // ---- Admin ----
  http.post("/api/admin/login", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    if (body.password !== MOCK_ADMIN_PASSWORD) {
      return HttpResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    state.authed = true;
    return HttpResponse.json(
      { ok: true },
      { headers: { "Set-Cookie": `${ADMIN_COOKIE}; Path=/; SameSite=Lax` } },
    );
  }),

  http.get("/api/admin/logs", ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      logs: state.logs.slice(start, start + pageSize),
      page,
      pageSize,
      total: state.logs.length,
    });
  }),

  http.get("/api/admin/media", ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    return HttpResponse.json({ media: state.media });
  }),

  http.get("/api/admin/searches", ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const limit = Math.max(1, Number(url.searchParams.get("limit") ?? 20));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    const page = state.searches.slice(offset, offset + limit);
    return HttpResponse.json({ searches: page, hasMore: offset + limit < state.searches.length });
  }),

  http.get("/api/admin/settings", ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    return HttpResponse.json(state.settings);
  }),

  http.patch("/api/admin/settings", async ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    const patch = (await request.json()) as Partial<AdminSettings>;
    state.settings = { ...state.settings, ...patch };
    return HttpResponse.json(state.settings);
  }),

  http.post("/api/admin/delete", async ({ request }) => {
    if (!isAuthed(request)) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json()) as { photoId: string };
    state.media = state.media.filter((m) => m.id !== body.photoId);
    return HttpResponse.json({ ok: true });
  }),
];
