import { verifyAdmin } from "@/lib/auth";
import { listMedia } from "@/lib/db";
import { previewUrl } from "@/lib/r2";

// Node runtime: reads from the postgres driver and verifies the JWT via jose.
export const runtime = "nodejs";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/** Parse a bounded non-negative integer from a query param, else a fallback. */
function intParam(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/**
 * GET /api/admin/media?limit=&offset= — the admin gallery feed: active photos
 * + active videos, newest first. Requires a valid admin cookie (401
 * otherwise). Each item carries a stable `id` (the row's photo/media id —
 * required by `POST /api/admin/delete`), its `kind`, the uploading guest
 * (null for ingest-sourced media), a public `thumbUrl`, and `uploadedAt`.
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const limit = intParam(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = intParam(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);

  const rows = await listMedia({ limit, offset });
  const media = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    guest: r.guest,
    thumbUrl: r.thumbKey ? previewUrl(r.thumbKey) : "",
    uploadedAt: new Date(r.uploadedAt).toISOString(),
  }));

  return Response.json({ media }, { status: 200 });
}
