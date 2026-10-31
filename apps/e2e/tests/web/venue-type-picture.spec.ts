import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** The "Venue types" picker shows each facility's picture, and its icon when it has none. */
test.describe('customer site: venue type pictures', () => {
  test('a facility with a picture shows it in the picker; one without shows its icon; both can be ticked', async ({ page }) => {
    await page.route(`${URLS.api}/categories**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue(); // the browser's CORS check goes through untouched
      const res = await route.fetch();
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      await route.fulfill({ response: res, json: rows.map((c, i) => ({ ...c, imageUrl: i === 0 ? PNG_DATA_URI : null })) });
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Venue types/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Venue types' });
    const tiles = dialog.getByRole('checkbox');
    await expect(tiles.nth(1)).toBeVisible(); // the facilities load after the page opens
    await expect(tiles.nth(0).locator('img')).toHaveAttribute('src', PNG_DATA_URI);
    await expect(tiles.nth(1).locator('img')).toHaveCount(0);
    await expect(tiles.nth(1).locator('svg')).toBeVisible();
    await tiles.nth(0).click();
    await expect(tiles.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('button', { name: /Show venues \(1 type\)/ })).toBeVisible();
  });
});
