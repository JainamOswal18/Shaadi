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

// Route ALL test database access to a dedicated Neon test branch, never
// production. When TEST_DATABASE_URL is set it overrides DATABASE_URL for the
// entire test process, so BOTH the raw `admin` client (process.env.DATABASE_URL)
// and @/lib/db bind to the test branch. Together with per-test schema isolation
// and the guard in src/lib/db.ts, this makes it impossible for a test run to
// mutate production. (See memory: shaadi-prod-wipe-incident — a test run once
// deleted the live gallery and had to be restored via Neon PITR.)
const prodDbUrl = dotEnv.DATABASE_URL?.trim();
const testDbUrl = dotEnv.TEST_DATABASE_URL?.trim();
if (testDbUrl) {
  if (testDbUrl === prodDbUrl) {
    throw new Error(
      "[vitest] TEST_DATABASE_URL must point at a SEPARATE Neon branch, not the " +
        "production DATABASE_URL. Refusing to run tests against production.",
    );
  }
  dotEnv.DATABASE_URL = testDbUrl;
} else {
  // No dedicated test branch configured. The src/lib/db.ts guard still prevents
  // a production wipe, but a separate branch is strongly recommended.
  console.warn(
    "\n\x1b[33m[vitest] TEST_DATABASE_URL is not set — integration tests will use " +
      "DATABASE_URL. Set TEST_DATABASE_URL to a dedicated Neon test branch to fully " +
      "isolate tests from production.\x1b[0m\n",
  );
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
