import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getReelJob, setReelJobStatus } from "@/lib/db";
import { loadEnv } from "@/lib/env";

// Node runtime: this route uses the postgres driver via @/lib/db.
export const runtime = "nodejs";

const CallbackSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["done", "error"]),
  outputKey: z.string().min(1).optional(),
  error: z.string().optional(),
});

/** Mirrors embed-service's own auth convenience: if no EMBED_API_KEY is
 *  configured (local dev), skip the check; otherwise require the bearer
 *  token to match, compared in constant time so a byte-by-byte early-exit
 *  string comparison can't leak the key length/prefix via response timing. */
function authorized(req: Request): boolean {
  const key = loadEnv().EMBED_API_KEY;
  if (!key) return true;
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${key}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on mismatched lengths, so guard that first —
  // this length check does leak length via timing, but not the key itself.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/reel/callback — the EC2 render-service reports a finished (or
 * failed) render here once ffmpeg completes. Bearer-authed with the same
 * EMBED_API_KEY used to dispatch the job.
 */
export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof CallbackSchema>;
  try {
    body = CallbackSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!(await getReelJob(body.jobId))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  await setReelJobStatus(body.jobId, {
    status: body.status,
    outputKey: body.outputKey ?? null,
    error: body.error ?? null,
  });
  return Response.json({ ok: true }, { status: 200 });
}
