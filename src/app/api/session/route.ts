import { getPhotosByIds, getSearchSession, getSettings } from "@/lib/db";
import { previewUrl } from "@/lib/r2";
import type { SessionResponse } from "@/lib/types";

// Node runtime: reads from the postgres driver, which does not run on edge.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/session?sessionId= — rebuild a past search's result set from the DB.
 *
 * Lets a returning guest (or a hard reload) restore their album *without*
 * re-taking a selfie: we look up the session's persisted `matched_ids` and
 * re-decorate the active photos with public thumb + preview URLs, preserving the
 * original match ordering. No embeddings, no originals, no selfie — purely the
 * public-preview view the guest already saw.
 */
export async function GET(req: Request): Promise<Response> {
  // Maintenance kill switch: refuse restores while search is paused.
  if ((await getSettings()).killSwitch) {
    return Response.json({ error: "maintenance" }, { status: 503 });
  }

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return Response.json({ error: "invalid_session_id" }, { status: 400 });
  }

  const session = await getSearchSession(sessionId);
  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const ids = session.matched_ids ?? [];
  const rows = await getPhotosByIds(ids);

  // Re-order to the session's stored ranking (getPhotosByIds order is arbitrary);
  // photos deleted/deactivated since the search simply drop out.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const matches = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({
      photoId: r.id,
      // Ranking is carried by array order; per-photo similarity isn't persisted.
      similarity: 1,
      thumbKey: r.thumb_key,
      previewKey: r.preview_key,
      thumbUrl: previewUrl(r.thumb_key),
      previewUrl: previewUrl(r.preview_key),
    }));

  const body: SessionResponse = {
    sessionId,
    guestName: session.guest_name,
    matches,
  };
  return Response.json(body, { status: 200 });
}
