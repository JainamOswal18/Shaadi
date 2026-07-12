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

test("collage: select photos, open the editor, and download a PNG", async ({ page }) => {
  await reachResults(page);

  // Enter selection mode.
  await page.getByTestId("make-collage").click();
  await expect(page.getByTestId("collage-select-bar")).toBeVisible();

  // Continue is disabled until at least one photo is chosen.
  const continueBtn = page.getByTestId("collage-continue");
  await expect(continueBtn).toBeDisabled();

  const selectable = page.getByTestId("photo-select");
  await selectable.nth(0).click();
  await selectable.nth(1).click();
  await selectable.nth(2).click();

  await expect(continueBtn).toBeEnabled();
  await continueBtn.click();

  // Editor opens.
  const editor = page.getByTestId("collage-maker");
  await expect(editor).toBeVisible();

  // Applying a preset keeps the editor usable.
  await page.getByRole("button", { name: "#OurWedding" }).click();

  // Render the styled DOM to a PNG and download it.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("collage-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test("collage editor supports ratio switch and per-slot zoom", async ({ page }) => {
  await reachResults(page);

  // Enter selection mode.
  await page.getByTestId("make-collage").click();
  await expect(page.getByTestId("collage-select-bar")).toBeVisible();

  const selectable = page.getByTestId("photo-select");
  await selectable.nth(0).click();
  await selectable.nth(1).click();
  await selectable.nth(2).click();

  await page.getByTestId("collage-continue").click();

  const editor = page.getByTestId("collage-maker");
  await expect(editor).toBeVisible();

  await page.getByRole("button", { name: /square/i }).click();
  await expect(page.getByText(/exports at 1080×1080/i)).toBeVisible();

  const slot = page.getByTestId(/collage-slot-0/);
  await slot.hover();
  await page.mouse.wheel(0, -200); // zoom in on the hovered slot

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("collage-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});
