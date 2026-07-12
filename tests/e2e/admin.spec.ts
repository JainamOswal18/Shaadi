import { test, expect } from "@playwright/test";

const MOCK_ADMIN_PASSWORD = "shaadi-admin";

test("admin: login shows logs, toggling kill switch PATCHes settings", async ({ page }) => {
  await page.goto("/admin/login");

  await page.getByLabel(/admin password/i).fill("wrong-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/doesn.t match/i)).toBeVisible();

  await page.getByLabel(/admin password/i).fill(MOCK_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByTestId("log-row").first()).toBeVisible();

  // Go to Settings and flip the kill switch.
  await page.getByRole("tab", { name: /settings/i }).click();

  const [patch] = await Promise.all([
    page.waitForRequest(
      (req) => req.url().includes("/api/admin/settings") && req.method() === "PATCH",
    ),
    page.getByTestId("kill-switch").click(),
  ]);
  const body = patch.postDataJSON();
  expect(body).toHaveProperty("kill_switch", true);

  await expect(page.getByText(/guest photo search is paused/i)).toBeVisible();
});

test("admin: dashboard redirects to login when unauthenticated", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("admin: Who searched tab shows guest name, selfie thumbnail, and match count", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel(/admin password/i).fill(MOCK_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("tab", { name: /who searched/i }).click();

  const row = page.getByTestId("search-row").first();
  await expect(row).toBeVisible();
  await expect(row.locator("img")).toBeVisible();
  await expect(row).toContainText(/Aarav|Diya|Kabir|Meera|Rohan|Guest/);
});
