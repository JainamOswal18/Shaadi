import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Guest passcode hashing. The shared guest passcode is never stored in plaintext:
// the admin PATCH route hashes an incoming plaintext passcode with a per-secret
// random salt using scrypt (a memory-hard KDF), and `/api/search` verifies a
// submitted passcode against the stored `salt:hash` in constant time.
//
// Storage format: `${saltHex}:${hashHex}`. scrypt parameters use Node's defaults
// (N=16384, r=8, p=1) via a 64-byte derived key, which is comfortably strong for
// a low-value shared passcode while staying fast enough for a per-search verify.

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;
const SALT_LEN = 16;

/** Hash a plaintext passcode into a storable `salt:hash` string. */
export async function hashPasscode(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scryptAsync(plaintext, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Verify a plaintext passcode against a stored `salt:hash`. Returns false for a
 * null/malformed stored value or any mismatch; the compare is constant-time so
 * it never leaks how close a wrong guess was. Never throws.
 */
export async function verifyPasscode(
  plaintext: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = (await scryptAsync(plaintext, salt, expected.length)) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
