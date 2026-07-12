import { test, expect } from "@playwright/test";

test("home has the Jeena document title", async ({ page }) => {
  await page.goto("/");
  // Playwright's toHaveTitle auto-waits/retries, so this is hydration-safe.
  await expect(page).toHaveTitle(/Our Wedding · Jeena/);
});
