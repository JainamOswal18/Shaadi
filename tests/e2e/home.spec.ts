import { test, expect } from "@playwright/test";
import { pngFile } from "./_helpers";

test("home: enter name + selfie, submit routes to results", async ({ page }) => {
  await page.goto("/");

  const nameField = page.getByLabel(/your name/i);
  await expect(nameField).toBeVisible();
  await nameField.fill("Priya Sharma");

  // Submit is disabled until a selfie is provided.
  const submit = page.getByRole("button", { name: /find my photos/i });
  await expect(submit).toBeDisabled();

  // Use the file-upload fallback (no camera in CI).
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile("selfie.png"));

  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page).toHaveURL(/\/results\?sid=/);
  await expect(page.getByRole("heading", { name: /photos/i })).toBeVisible();
});
