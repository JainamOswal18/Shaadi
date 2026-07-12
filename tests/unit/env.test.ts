import { describe, it, expect } from "vitest";
import { loadEnv } from "@/lib/env";

describe("env", () => {
  it("parses required vars", () => {
    process.env.DATABASE_URL ??= "postgres://u:p@h/db";
    process.env.R2_ENDPOINT ??= "https://x.r2.cloudflarestorage.com";
    process.env.R2_ACCESS_KEY_ID ??= "k";
    process.env.R2_SECRET_ACCESS_KEY ??= "s";
    process.env.R2_PREVIEWS_PUBLIC_URL ??= "https://pub-x.r2.dev";
    process.env.ADMIN_PASSWORD ??= "pw";
    process.env.SESSION_SECRET ??= "sess";
    expect(loadEnv().R2_BUCKET_ORIGINALS).toBe("shaadi-photos");
  });
});
