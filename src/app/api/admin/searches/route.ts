import { verifyAdmin } from "@/lib/auth";
import { listSearches } from "@/lib/db";
import { presignGet } from "@/lib/r2";

// Node runtime: reads from the postgres driver, verifies the JWT via jose, and
// presigns R2 GET URLs via the AWS SDK.
export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Parse a bounded non-negative integer from a query param, else a fallback. */
function intParam(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/**
 * GET /api/admin/searches?limit=&offset= — the admin "Who searched" feed:
 * recent guest searches, newest first. Requires a valid admin cookie (401
 * otherwise). Each item carries the guest name (if given), when the search
 * happened, how many photos matched, and a short-lived signed `selfieUrl` for
 * the privately stored selfie (null when none was stored — e.g. R2 was
 * unreachable at search time). `hasMore` tells the caller whether another page
 * exists, based on whether this page came back full.
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const limit = intParam(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = intParam(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);

  const rows = await listSearches({ limit, offset });
  const searches = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      guestName: r.guest_name,
      at: new Date(r.created_at).toISOString(),
      matchCount: r.match_count ?? 0,
      selfieUrl: r.selfie_key ? await presignGet(r.selfie_key) : null,
    })),
  );

  return Response.json({ searches, hasMore: rows.length === limit }, { status: 200 });
}
