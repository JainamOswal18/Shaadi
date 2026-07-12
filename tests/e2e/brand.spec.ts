import { test, expect } from "@playwright/test";

test("home has the Jeena title and no Devanagari", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Our Wedding · Jeena/);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("शादी");
  expect(body).not.toContain("जीना");
});
