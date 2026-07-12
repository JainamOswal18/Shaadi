import { randomUUID } from "node:crypto";
import { getSettings, logSearch, searchByEmbedding } from "@/lib/db";
import { embedImage, largestFace } from "@/lib/embed-client";
import { verifyPasscode } from "@/lib/passcode";
import { previewUrl, putObject } from "@/lib/r2";
import { checkRateLimit } from "@/lib/ratelimit";
import type { SearchResponse } from "@/lib/types";

// Node runtime: this route uses `node:crypto`, the AWS S3 client, and the
// postgres driver, none of which run on the edge runtime.
export const runtime = "nodejs";

// Cap on how many candidate matches we return to the client for one selfie.
// No practical cap: a subject (e.g. the couple) can appear in most of the
// gallery, so return everyone's full set. Bounded above by the gallery size.
const MATCH_LIMIT = 5000;

/**
 * Resolve the originating client IP. Behind Vercel/Cloudflare the real client is
 * the first hop in `x-forwarded-for`; `x-real-ip` is the single-value fallback.
 */
function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || null;
}

/**
 * POST /api/search — the core "find my photos" endpoint.
 *
 * Accepts `multipart/form-data` with a `selfie` file and optional `guestName`,
 * embeds the largest face, and returns every active photo whose face matches
 * above the admin-configured similarity threshold, each decorated with public
 * thumbnail + preview URLs.
 */
export async function POST(req: Request): Promise<Response> {
  const settings = await getSettings();

  // 1. Maintenance kill switch: refuse all searches.
  if (settings.killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  // 2. Per-IP sliding-window rate limit.
  const ip = clientIp(req);
  if (!(await checkRateLimit(ip))) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  // 3. Parse the multipart body.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid_form" }, { status: 400 });
  }
  const selfie = form.get("selfie");
  if (!(selfie instanceof File)) {
    return Response.json({ error: "missing_selfie" }, { status: 400 });
  }
  const guestNameRaw = form.get("guestName");
  const guestName =
    typeof guestNameRaw === "string" && guestNameRaw.trim() ? guestNameRaw.trim() : null;

  // 3b. Passcode gate: when the admin has enabled a shared guest passcode, a
  //     correct passcode is required before any embedding/search work runs.
  if (settings.passcodeEnabled) {
    const passcodeRaw = form.get("passcode");
    const passcode = typeof passcodeRaw === "string" ? passcodeRaw : "";
    if (!passcode || !(await verifyPasscode(passcode, settings.passcodeHash))) {
      return Response.json({ error: "passcode" }, { status: 403 });
    }
  }

  const bytes = Buffer.from(await selfie.arrayBuffer());

  // 4. Embed the selfie and pick the largest detected face.
  let embedResponse: Awaited<ReturnType<typeof embedImage>>;
  try {
    embedResponse = await embedImage(bytes);
  } catch (err) {
    // Embed function unreachable/timed out — fail clean instead of hanging.
    console.error("search: embed function failed:", err);
    return Response.json({ error: "embed_unavailable" }, { status: 502 });
  }
  const embedding = largestFace(embedResponse);
  if (!embedding) {
    return Response.json({ error: "no_face" }, { status: 422 });
  }

  // 5. Correlate this search under a fresh session id.
  const sessionId = randomUUID();

  // 5b. Privately persist the selfie for the admin "Who searched" view. This is
  //     best-effort: a storage failure must never fail the guest-facing search,
  //     so we swallow the error and log a null selfie_key instead. The object
  //     lives in the private originals bucket (never the public previews
  //     bucket) — only a short-lived signed URL exposes it, to an admin only.
  let selfieKey: string | null = null;
  try {
    const key = `selfies/${sessionId}.jpg`;
    await putObject(key, bytes, "image/jpeg");
    selfieKey = key;
  } catch (err) {
    console.error("search: selfie storage failed (non-fatal):", err);
  }

  // 6. Vector search for matching faces above the configured threshold.
  const results = await searchByEmbedding(embedding, settings.matchThreshold, MATCH_LIMIT);

  // 7. Decorate each match with public preview + thumbnail URLs.
  const matches = results.map((m) => ({
    ...m,
    thumbUrl: previewUrl(m.thumbKey),
    previewUrl: previewUrl(m.previewKey),
  }));

  // 8. Audit-log the search under this session id, persisting the matched
  //    photo ids so the ZIP-download endpoint can rebuild the set later.
  await logSearch({
    id: sessionId,
    guestName,
    ip,
    userAgent: req.headers.get("user-agent"),
    selfieKey,
    matchCount: matches.length,
    matchedIds: matches.map((m) => m.photoId),
  });

  // 9. Return the session id + decorated matches.
  const body: SearchResponse = { sessionId, matches };
  return Response.json(body, { status: 200 });
}
