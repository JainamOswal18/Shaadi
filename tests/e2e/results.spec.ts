import { test, expect } from "@playwright/test";
import { pngFile, seedIntroSeen } from "./_helpers";

async function reachResults(page: import("@playwright/test").Page) {
  await seedIntroSeen(page);
  await page.goto("/");
  await page.getByLabel(/your name/i).fill("Priya Sharma");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile("selfie.png"));
  await page.getByRole("button", { name: /find my photos/i }).click();
  await expect(page).toHaveURL(/\/results\?sid=/);
}

test("results: grid renders 5 thumbs, lightbox opens, download-all fires zip request", async ({
  page,
}) => {
  await reachResults(page);

  const thumbs = page.getByTestId("photo-thumb");
  await expect(thumbs).toHaveCount(5);

  // Open the lightbox on the first photo.
  await thumbs.first().click();
  await expect(page.getByTestId("lightbox-image")).toBeVisible();

  // Navigate to the next photo.
  await page.getByRole("button", { name: /next photo/i }).click();
  await expect(page.getByTestId("lightbox-image")).toBeVisible();

  // Close and trigger "Download all (ZIP)".
  await page.getByRole("button", { name: /close photo/i }).click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-all").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});
