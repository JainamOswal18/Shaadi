// @vitest-environment node
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { ADMIN_COOKIE, signAdmin, verifyAdmin } from "@/lib/auth";
import { loadEnv } from "@/lib/env";

// B5: the admin session JWT is signed with a key derived from SESSION_SECRET,
// NOT from ADMIN_PASSWORD. These tests pin that contract so a regression back to
// password-derived signing (or an unsigned/foreign key) is caught.

function reqWithCookie(token: string): Request {
  return new Request("http://localhost/api/admin/anything", {
    headers: { cookie: `${ADMIN_COOKIE}=${token}` },
  });
}

function keyFrom(secret: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(secret).digest());
}

async function signWith(secret: string): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keyFrom(secret));
}

describe("admin auth (B5: SESSION_SECRET signing key)", () => {
  it("accepts a token minted by signAdmin()", async () => {
    const token = await signAdmin();
    expect(await verifyAdmin(reqWithCookie(token))).toBe(true);
  });

  it("accepts a token signed with SESSION_SECRET's derived key", async () => {
    const token = await signWith(loadEnv().SESSION_SECRET);
    expect(await verifyAdmin(reqWithCookie(token))).toBe(true);
  });

  it("rejects a token signed with the (old) ADMIN_PASSWORD-derived key", async () => {
    // Guard the test itself: only meaningful when the two secrets differ.
    expect(loadEnv().SESSION_SECRET).not.toBe(loadEnv().ADMIN_PASSWORD);
    const token = await signWith(loadEnv().ADMIN_PASSWORD);
    expect(await verifyAdmin(reqWithCookie(token))).toBe(false);
  });

  it("rejects a missing or garbage cookie", async () => {
    expect(await verifyAdmin(new Request("http://localhost/x"))).toBe(false);
    expect(await verifyAdmin(reqWithCookie("not-a-jwt"))).toBe(false);
  });
});
