import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';
import { exploreLaterDay } from '../../support/customer-ui';

test.use({ baseURL: URLS.web });

/** The venue's booking page: switching facility changes only what depends on it, and never reloads the page. */
test.describe('customer site: venue booking page', () => {
  test('switching facility keeps the page (header, tiles) in place and rewrites the address', async ({ page }) => {
    await exploreLaterDay(page);
    // A venue with more than one facility.
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    let opened = false;
    for (let i = 0; i < (await cards.count()); i++) {
      if ((await cards.nth(i).getByRole('tab').count()) > 1) {
        await cards.nth(i).getByRole('link', { name: 'Book Now' }).click();
        opened = true;
        break;
      }
    }
    test.skip(!opened, 'no venue with two facilities in the data');

    await expect(page).toHaveURL(/\/book\//);
    const tiles = page.getByRole('tablist').getByRole('tab');
    await expect(tiles.nth(1)).toBeVisible();
    const before = page.url();
    // Marks the header and the tile row: if the page remounts, the marks are gone.
    await page.evaluate(() => {
      (document.querySelector('header') as HTMLElement & { __kept?: boolean }).__kept = true;
      (document.querySelector('[role="tablist"]') as HTMLElement & { __kept?: boolean }).__kept = true;
    });
    await tiles.nth(1).click();
    await expect(tiles.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tiles.nth(0)).toHaveAttribute('aria-selected', 'false');
    expect(page.url()).not.toBe(before);
    expect(page.url()).toMatch(/\/book\/[^/]+\/[^/?]+\?date=\d{4}-\d{2}-\d{2}/);
    const kept = await page.evaluate(() => [
      (document.querySelector('header') as HTMLElement & { __kept?: boolean }).__kept === true,
      (document.querySelector('[role="tablist"]') as HTMLElement & { __kept?: boolean }).__kept === true,
    ]);
    expect(kept).toEqual([true, true]);

    // Reloading the new address opens the same facility.
    await page.reload();
    await expect(page.getByRole('tablist').getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  });
});
