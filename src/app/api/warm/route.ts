import { getSettings } from "@/lib/db";
import { loadEnv } from "@/lib/env";

// Node runtime: reads the postgres driver, which does not run on the edge.
export const runtime = "nodejs";

// Never cache: every invocation must actually touch the DB + embed fn.
export const dynamic = "force-dynamic";

// Cheap upper bound on the embed-fn ping so a cold/unreachable function
// doesn't hold this warm invocation open.
const PING_TIMEOUT_MS = 8_000;

/**
 * GET /api/warm — cron target (see vercel.json) that keeps the Postgres
 * connection and the Python embed function warm so guest-facing requests
 * don't eat a cold start. Intentionally cheap: one settings read (DB) and one
 * best-effort GET to the embed function's base URL (no image processing).
 */
export async function GET(): Promise<Response> {
  await getSettings();

  const embedFnUrl = loadEnv().EMBED_FN_URL;
  if (embedFnUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      await fetch(embedFnUrl, { method: "GET", signal: controller.signal });
    } catch {
      // Best-effort only: a cold start or transient error here should never
      // fail the warm ping itself.
    } finally {
      clearTimeout(timer);
    }
  }

  return Response.json({ ok: true }, { status: 200 });
}
