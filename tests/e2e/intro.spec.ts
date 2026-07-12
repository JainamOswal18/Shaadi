import { test, expect } from "@playwright/test";

// The Magazine intro is a one-time, full-screen overlay shown over the Home
// search form on a guest's first visit. These specs deliberately do NOT seed
// `shaadi_intro_seen_v1`, so each starts as a genuine first visit.

test("intro: shows on first visit and Skip reveals the search form", async ({ page }) => {
  await page.goto("/");

  // Intro overlay is present; the search form is hidden behind it.
  const skip = page.getByTestId("intro-skip");
  await expect(skip).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Nameeta/i }),
  ).toBeVisible();

  await skip.click();

  // Overlay dismissed; the name field is now available.
  await expect(page.getByTestId("intro-skip")).toHaveCount(0);
  await expect(page.getByLabel(/your name/i)).toBeVisible();
});

test("intro: paging through to the CTA reveals the search form", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("intro-next").click(); // → panel 2
  await page.getByTestId("intro-next").click(); // → panel 3 (last)
  await page.getByTestId("intro-cta").click();

  await expect(page.getByTestId("intro-skip")).toHaveCount(0);
  await expect(page.getByLabel(/your name/i)).toBeVisible();
});

test("intro: is shown only once — a return visit lands straight on the form", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("intro-skip").click();
  await expect(page.getByLabel(/your name/i)).toBeVisible();

  // Reload: the intro must not reappear (dismissal persisted to localStorage).
  await page.reload();
  await expect(page.getByTestId("intro-skip")).toHaveCount(0);
  await expect(page.getByLabel(/your name/i)).toBeVisible();
});
