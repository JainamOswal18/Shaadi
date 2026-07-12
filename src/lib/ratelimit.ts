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

// Dedicated limiter for /api/reel: each reel job dispatches an ffmpeg render
// on the shared EC2 box, so it needs its own cap independent of the search
// limiter above (which only ever counts `search_sessions` rows — the reel
// route never writes one, so reusing checkRateLimit there is a no-op and
// reels are effectively unlimited). A client IP may create at most
// MAX_REEL_JOBS reel_jobs rows within the trailing REEL_JOB_WINDOW.
const MAX_REEL_JOBS = 5; // max reel jobs per IP per REEL_JOB_WINDOW

/**
 * Return whether a reel render from `ip` is allowed right now. A request is
 * allowed when fewer than MAX_REEL_JOBS reel_jobs rows have been recorded for
 * this IP in the trailing 10-minute window.
 *
 * As with checkRateLimit, an unknown IP (`null`) is allowed: we cannot
 * attribute it to a caller, and failing open is preferable to blocking every
 * request that arrives without a forwarded-for/real-ip header.
 */
export async function checkReelRateLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from reel_jobs
    where ip = ${ip}
      and created_at > now() - interval '10 minutes'`;
  return Number(rows[0]?.count ?? 0) < MAX_REEL_JOBS;
}
