import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { loadEnv } from "./env";

// Admin session auth. A successful login mints a short-lived HS256 JWT stored in
// the `shaadi_admin` httpOnly cookie; every protected route verifies it.
//
// The HMAC signing key is the SHA-256 digest of the dedicated, high-entropy
// SESSION_SECRET (not derived from ADMIN_PASSWORD). Keeping the session key
// separate from the login credential means rotating one does not force rotating
// the other, and the signing key never depends on the guessability of a
// human-chosen password. Hashing yields a stable 32-byte key regardless of the
// secret's raw length.

export const ADMIN_COOKIE = "shaadi_admin";
const ALG = "HS256";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // ~7 days

function signingKey(): Uint8Array {
  return new Uint8Array(createHash("sha256").update(loadEnv().SESSION_SECRET).digest());
}

/** Mint a signed admin session token (`{ role: "admin" }`, ~7d expiry). */
export async function signAdmin(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(signingKey());
}

/**
 * Verify the `shaadi_admin` cookie on a request. Returns true only when a valid,
 * unexpired, correctly-signed admin token is present; false for a missing,
 * malformed, expired, or tampered token (never throws).
 */
export async function verifyAdmin(req: Request): Promise<boolean> {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingKey(), { algorithms: [ALG] });
    return payload.role === "admin";
  } catch {
    return false;
  }
}

/**
 * Serialize the admin session cookie. `secure` is set only in production so the
 * cookie still works over plain http in local dev; `sameSite=lax` lets it ride
 * top-level navigations to the admin pages while blocking cross-site POSTs.
 */
export function adminCookie(token: string): string {
  const parts = [
    `${ADMIN_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Read a single cookie value out of a request's Cookie header, or null. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}
