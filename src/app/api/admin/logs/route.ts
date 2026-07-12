import { verifyAdmin } from "@/lib/auth";
import { listLogs } from "@/lib/db";

// Node runtime: reads from the postgres driver and verifies the JWT via jose.
export const runtime = "nodejs";

const PAGE_SIZE = 20;

/** Parse a positive integer page number from a query param, else 1. */
function pageParam(value: string | null): number {
  if (value === null) return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * GET /api/admin/logs?page= — paginated activity feed for the admin console:
 * a UNION of search/upload/download audit events, newest first. Requires a
 * valid admin cookie (401 otherwise).
 */
export async function GET(req: Request): Promise<Response> {
  if (!(await verifyAdmin(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const page = pageParam(new URL(req.url).searchParams.get("page"));
  const { rows, total } = await listLogs({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  const logs = rows.map((r) => ({
    id: r.id,
    type: r.type,
    guest: r.guest ?? "Guest",
    detail: r.detail,
    at: new Date(r.at).toISOString(),
  }));

  return Response.json({ logs, page, pageSize: PAGE_SIZE, total }, { status: 200 });
}
