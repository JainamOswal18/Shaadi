import { test, expect } from "@playwright/test";
import { pngFile } from "./_helpers";

test("upload: selecting 2 photos uploads them and decrements quota", async ({ page }) => {
  await page.goto("/upload");

  await expect(page.getByRole("heading", { name: /share your memories/i })).toBeVisible();
  await page.getByLabel(/your name/i).fill("Priya Sharma");
  // Starts at full quota.
  await expect(page.getByText("0 / 20")).toBeVisible();

  await page
    .locator('input[type="file"][accept="image/*,video/*"]')
    .setInputFiles([pngFile("one.png"), pngFile("two.png")]);

  await expect(page.getByTestId("upload-item")).toHaveCount(2);

  await page.getByTestId("start-upload").click();

  // Success toast + quota reflects 2 photos used.
  await expect(page.getByText(/uploaded 2 files/i)).toBeVisible();
  await expect(page.getByText("2 / 20")).toBeVisible();
});

test("upload: start-upload stays disabled until a guest name is entered", async ({ page }) => {
  await page.goto("/upload");

  await page
    .locator('input[type="file"][accept="image/*,video/*"]')
    .setInputFiles([pngFile("solo.png")]);
  await expect(page.getByTestId("upload-item")).toHaveCount(1);

  const submit = page.getByTestId("start-upload");
  await expect(submit).toBeDisabled();

  await page.getByLabel(/your name/i).fill("A");
  await expect(submit).toBeDisabled(); // below the 2-char minimum

  await page.getByLabel(/your name/i).fill("Aarav");
  await expect(submit).toBeEnabled();
});

// F-dup: grants used to be keyed by raw filename, so two queued files sharing
// a name collided on the same presigned grant/key and one upload silently
// clobbered the other. Assert each queued item gets its own distinct PUT
// target even when filenames are identical.
test("upload: duplicate filenames each get their own upload grant (no key collision)", async ({
  page,
}) => {
  await page.goto("/upload");
  await page.getByLabel(/your name/i).fill("Priya Sharma");

  const putUrls: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/put/")) putUrls.push(req.url());
  });

  await page
    .locator('input[type="file"][accept="image/*,video/*"]')
    .setInputFiles([pngFile("same.png"), pngFile("same.png")]);
  await expect(page.getByTestId("upload-item")).toHaveCount(2);

  await page.getByTestId("start-upload").click();
  await expect(page.getByText(/uploaded 2 files/i)).toBeVisible();

  expect(putUrls).toHaveLength(2);
  expect(new Set(putUrls).size).toBe(2);
});
