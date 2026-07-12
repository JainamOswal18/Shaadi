import { test, expect } from "@playwright/test";
import { pngFile } from "./_helpers";

// F4a: /api/search returns a real 503 {error:"maintenance"} when the host's
// kill switch is on. The home page must show the dedicated "paused" message
// (not a generic error toast) and must not navigate to /results.
//
// Seeds the mock's kill switch via `window.__E2E_SETTINGS__`, read by
// src/mocks/handlers.ts before its module state is constructed. This is the
// only reliable way to start a fresh page load already in maintenance mode:
// a real `page.goto` is a hard navigation that would reset any state flipped
// through the admin UI in an earlier step.
test("home: maintenance mode shows the paused message, not a generic error", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS__?: object }).__E2E_SETTINGS__ = {
      kill_switch: true,
    };
  });
  await page.goto("/");

  await page.getByLabel(/your name/i).fill("Priya Sharma");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile("selfie.png"));

  await page.getByRole("button", { name: /find my photos/i }).click();

  await expect(page.getByText(/photo finding is paused/i)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/results/);
});
