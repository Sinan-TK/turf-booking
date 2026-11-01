import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

/**
 * A unit with nothing left to book (all booked, or the day's time has passed) stays in the list, greyed out, with no Book Now.
 * The API's answer is real data with the start times emptied, which is what the API now returns for such a unit.
 */
test.describe('customer site: nothing left to book', () => {
  test('a venue with no slots left is shown greyed out, says so, and cannot be booked', async ({ page }) => {
    await page.route(`${URLS.api}/search**`, async (route) => {
      const res = await route.fetch();
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      const emptied = rows.map((r) => ({ ...r, availableStartTimes: [], price: null, priceVaries: false, startPrices: [], startNormalPrices: [], startBookingPrices: [] }));
      await route.fulfill({ response: res, json: emptied });
    });
    await page.goto('/explore');
    const card = page.locator('article[data-sold-out="true"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('No slots left');
    await expect(card.getByRole('link', { name: 'Book Now' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /No slots left for this day/ })).toBeDisabled();
  });
});
