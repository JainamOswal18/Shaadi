import type { Page } from "@playwright/test";

/** A tiny valid 1×1 PNG, used as a stand-in selfie / upload file. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export function pngFile(name: string) {
  return { name, mimeType: "image/png", buffer: PNG_1PX };
}

/** MSW boots before pages render, so waiting for real content = worker ready. */
export async function gotoReady(page: Page, path: string, ready: string) {
  await page.goto(path);
  await page.getByText(ready, { exact: false }).first().waitFor({ state: "visible" });
}
