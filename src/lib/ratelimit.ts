import { sql } from "@/lib/db";

// Sliding-window rate limit backed by the `search_sessions` audit table: a
// client IP may start at most MAX_SESSIONS searches per WINDOW. Using the same
// table we already write on every search keeps the limiter stateless (no extra
// store) and self-cleaning (old rows fall out of the window automatically).
const MAX_SESSIONS = 30;

/**
 * Return whether a search from `ip` is allowed right now. A request is allowed
 * when fewer than MAX_SESSIONS search sessions have been recorded for this IP in
 * the trailing one-hour window.
 *
 * When the IP is unknown (`null`) we allow the request: we cannot attribute it
 * to a caller, and failing open here is preferable to blocking every request
 * that arrives without a forwarded-for/real-ip header.
 */
export async function checkRateLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from search_sessions
    where ip = ${ip}
      and created_at > now() - interval '1 hour'`;
  return Number(rows[0]?.count ?? 0) < MAX_SESSIONS;
}
