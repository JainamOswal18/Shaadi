import type { Page } from "@playwright/test";

/** A tiny valid 1×1 PNG, used as a stand-in selfie / upload file. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export function pngFile(name: string) {
  return { name, mimeType: "image/png", buffer: PNG_1PX };
}

/**
 * Mark the one-time Magazine intro as already seen so specs that exercise the
 * Home search form land on it directly (the intro is a full-screen overlay on
 * a first visit). Must be called before `page.goto`. The dedicated intro spec
 * deliberately skips this to test the first-visit flow.
 */
export async function seedIntroSeen(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("shaadi_intro_seen_v1", "1");
    } catch {
      // storage disabled — nothing to seed
    }
  });
}

/** MSW boots before pages render, so waiting for real content = worker ready. */
export async function gotoReady(page: Page, path: string, ready: string) {
  await page.goto(path);
  await page.getByText(ready, { exact: false }).first().waitFor({ state: "visible" });
}
