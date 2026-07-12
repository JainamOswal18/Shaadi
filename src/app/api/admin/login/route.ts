import { createHash, timingSafeEqual } from "node:crypto";
import { adminCookie, signAdmin } from "@/lib/auth";
import { loadEnv } from "@/lib/env";

// Node runtime: uses node:crypto for the constant-time compare and jose (via
// auth.ts) to sign the session token.
export const runtime = "nodejs";

/**
 * Constant-time string equality. Both inputs are hashed to a fixed 32-byte
 * digest before comparison so `timingSafeEqual` never sees mismatched lengths
 * (which would throw and also leak length via the exception), and the compare
 * time is independent of where the strings first differ.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/**
 * POST /api/admin/login — body `{ password }`. On a constant-time match against
 * ADMIN_PASSWORD, sets the signed `shaadi_admin` httpOnly cookie and returns
 * 200; otherwise 401 with no cookie.
 */
export async function POST(req: Request): Promise<Response> {
  let password: unknown;
  try {
    password = (await req.json())?.password;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof password !== "string" || !safeEqual(password, loadEnv().ADMIN_PASSWORD)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await signAdmin();
  const res = Response.json({ ok: true }, { status: 200 });
  res.headers.set("Set-Cookie", adminCookie(token));
  return res;
}
