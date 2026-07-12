import { test, expect } from "@playwright/test";
import { pngFile, seedIntroSeen } from "./_helpers";

// The face-embedding compute is hosted separately from Vercel (see
// embed-service/) and can be unreachable — e.g. mid-deploy on EC2 — long
// after the rest of the app is live. /api/search surfaces that as a real
// 502 {error:"embed_unavailable"}; the home page must show a calm "check
// back soon" info state (not a scary error toast) and must not navigate to
// /results.
//
// Seeds the mock's embed-unavailable condition via `window.__E2E_SETTINGS__`,
// read by src/mocks/handlers.ts before its module state is constructed —
// same mechanism as maintenance.spec.ts / passcode.spec.ts.
test("home: embed service unavailable shows a calm 'coming soon' message, not an error toast", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS__?: object }).__E2E_SETTINGS__ = {
      embed_unavailable: true,
    };
  });
  await seedIntroSeen(page);
  await page.goto("/");

  await page.getByLabel(/your name/i).fill("Priya Sharma");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile("selfie.png"));

  await page.getByRole("button", { name: /find my photos/i }).click();

  await expect(page.getByText(/photo finding is being set up/i)).toBeVisible();
  await expect(page.getByText(/check back soon/i)).toBeVisible();
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/results/);
});
