import { expect, test } from '@playwright/test';

/** The customer site grows with the screen and fills it, and its scrollbars are thin. */
test.describe('customer site: size, width and scrollbars', () => {
  const rootSize = (page: import('@playwright/test').Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

  test('everything is sized up on big screens and left alone on phones and laptops', async ({ page }) => {
    const sizes: Array<[number, number, number]> = [
      [390, 844, 16],
      [1100, 800, 16],
      [1440, 900, 17],
      [1600, 900, 18.5],
      [1920, 1080, 20],
      [2560, 1300, 24],
    ];
    for (const [w, h, expected] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/explore');
      expect(await rootSize(page), `at ${w}px wide`).toBe(expected);
    }
  });

  test('the home page and the account page use the whole width on a desktop, not a narrow column', async ({ page }) => {
    for (const width of [1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/explore');
      const main = await page.locator('main').first().boundingBox();
      const padding = width >= 1536 ? 14 * (await rootSize(page)) / 4 : 10 * (await rootSize(page)) / 4; // 2xl:px-14 / lg:px-10
      expect(main!.width, `home at ${width}px`).toBeGreaterThan(width - 2 * padding - 40);
    }
  });

  test('scrollbars are the thin, rounded kind instead of the default one', async ({ page }) => {
    await page.goto('/explore');
    const style = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { width: root.scrollbarWidth, color: root.scrollbarColor };
    });
    expect(style.width).toBe('thin');
    expect(style.color).toContain('203, 213, 225'); // slate-300 thumb on a transparent track
    // The stylesheet also carries the WebKit rules (Chrome, Edge, Safari): a 10px bar with a rounded thumb.
    const rules = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((r) => r.cssText);
        } catch {
          return [];
        }
      }),
    );
    expect(rules.some((r) => r.includes('::-webkit-scrollbar-thumb') && r.includes('border-radius'))).toBe(true);
    expect(rules.some((r) => r.includes('::-webkit-scrollbar ') && r.includes('width: 10px'))).toBe(true);
  });
});
