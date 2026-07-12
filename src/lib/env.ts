import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  R2_ENDPOINT: z.string().url(),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_ORIGINALS: z.string().default("shaadi-photos"),
  R2_BUCKET_PREVIEWS: z.string().default("shaadi-previews"),
  R2_PREVIEWS_PUBLIC_URL: z.string().url(),
  ADMIN_PASSWORD: z.string().min(1),
  // High-entropy secret used as the HMAC signing key for admin session JWTs
  // (see src/lib/auth.ts). Kept separate from ADMIN_PASSWORD so rotating the
  // password does not require rotating session keys and vice versa.
  SESSION_SECRET: z.string().min(1),
  EMBED_FN_URL: z.string().url().optional(),
  // Shared-secret sent as `Authorization: Bearer <EMBED_API_KEY>` to the embed
  // service (see embed-service/app.py). Optional so local dev / tests can run
  // against an unauthenticated embed service; required in practice once the
  // embed service is reachable from the public internet (EC2).
  EMBED_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  cached = Schema.parse(process.env);
  return cached;
}
