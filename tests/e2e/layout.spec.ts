import { test, expect } from "@playwright/test";
import { seedIntroSeen } from "./_helpers";

const pages = ["/", "/upload", "/admin/login"];
const widths = [375, 1440];

for (const path of pages) {
  for (const width of widths) {
    test(`no horizontal overflow: ${path} @ ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedIntroSeen(page);
      await page.goto(path);
      // Wait for real content (MSW-gated render) to settle.
      await page.locator("main").first().waitFor({ state: "visible" });
      const overflow = await page.evaluate(() => {
        const el = document.scrollingElement!;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
}
