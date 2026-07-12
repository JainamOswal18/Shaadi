import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Load repo-root .env (for DATABASE_URL etc.) so tests that talk to the real
// Neon DB can call loadEnv() without a separate dotenv dependency. Values are
// injected via Vitest's `test.env`, which applies to every test process
// (forks/threads) before test files import anything.
function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}

const dotEnv = loadDotEnv(fileURLToPath(new URL("./.env", import.meta.url)));
// Fill in required-but-irrelevant-to-DB-tests vars only when unset/empty in
// .env, so real values (e.g. DATABASE_URL) still win.
for (const [key, fallback] of Object.entries({
  ADMIN_PASSWORD: "test-admin-password",
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
})) {
  if (!dotEnv[key]) dotEnv[key] = fallback;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
      "tests/components/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["./tests/unit/setup.ts"],
    env: dotEnv,
    // Integration suites hit a real (remote) Neon DB and unit suites encode
    // 4000x3000 AVIF previews with sharp — both are legitimately slow, and slower
    // still when Vitest's fork workers run them in parallel against a DB already
    // under load. The default 5s per-test timeout is too tight for that; give
    // real, CPU/IO-bound work realistic headroom so passes are deterministic.
    testTimeout: 30_000,
    // beforeAll/afterAll hooks create+drop the isolated test schema on the same
    // remote Neon DB; under concurrent load (e.g. an ingest running) the 10s
    // default is too tight. Match the test timeout.
    hookTimeout: 30_000,
  },
});
