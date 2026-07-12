import { test, expect } from "@playwright/test";
import { pngFile, seedIntroSeen } from "./_helpers";

// Mirrors MOCK_PASSCODE in src/mocks/handlers.ts.
const MOCK_PASSCODE = "1234-mandap";

// F6: when GET /api/config reports passcodeRequired, the home screen must
// show a required passcode field and send it with the search; a wrong
// passcode surfaces "Incorrect passcode." (403 {error:"passcode"}) and a
// correct one proceeds to /results.
test("home: passcode required — field is required, wrong code rejected, correct code proceeds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS__?: object }).__E2E_SETTINGS__ = {
      passcode_enabled: true,
    };
  });
  await seedIntroSeen(page);
  await page.goto("/");

  await page.getByLabel(/your name/i).fill("Priya Sharma");
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile("selfie.png"));

  const passcodeField = page.getByLabel(/event passcode/i);
  await expect(passcodeField).toBeVisible();
  const submit = page.getByRole("button", { name: /find my photos/i });
  await expect(submit).toBeDisabled();

  await passcodeField.fill("wrong-code");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(/incorrect passcode/i)).toBeVisible();
  await expect(page).not.toHaveURL(/\/results/);

  await passcodeField.fill(MOCK_PASSCODE);
  await submit.click();
  await expect(page).toHaveURL(/\/results\?sid=/);
});

test("home: passcode field is absent when the host hasn't required one", async ({ page }) => {
  await seedIntroSeen(page);
  await page.goto("/");
  await page.getByLabel(/your name/i).waitFor({ state: "visible" });
  await expect(page.getByLabel(/event passcode/i)).toHaveCount(0);
});
