import { expect, test } from '@playwright/test';
import { scanForViolations } from '../../support/csp';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

/** The landing page at "/" (advertising, venue types, how it works) and the venue listing now at "/explore". */
test.describe('customer site: landing page', () => {
  test('"/" is the landing page and the listing is at /explore', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Book your game/, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Browse by type' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Own a venue?' })).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0); // no venue cards on the landing page

    await page.goto('/explore');
    await expect(page.getByPlaceholder('Search venues, turfs, pools')).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the search box and the venue types lead into the listing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('search').getByRole('textbox').fill('Manjeri');
    await page.getByRole('button', { name: 'Find venues' }).click();
    await expect(page).toHaveURL(/\/explore\?q=Manjeri$/);
    await expect(page.getByPlaceholder('Search venues, turfs, pools')).toHaveValue('Manjeri');

    await page.goto('/');
    const link = page.locator('a[href^="/explore?type="]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    await link.click();
    await expect(page).toHaveURL(`${URLS.web}${href}`);
    // The type is already picked in the listing.
    await expect(page.getByRole('button', { name: /Venue types, 1 selected/ })).toBeVisible();
  });

  test('live banners are shown as a slider with their title, and link where the admin said', async ({ page }) => {
    await page.route(`${URLS.api}/banners`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify([
          { id: '1', title: 'Weekend football offer', subtitle: 'Book before Friday', imageUrl: null, linkUrl: '/explore?type=FOOTBALL_TURF' },
          { id: '2', title: 'Hostile link', subtitle: null, imageUrl: null, linkUrl: 'javascript:alert(1)' },
        ]),
      });
    });
    await page.goto('/');
    const slider = page.getByRole('region', { name: 'Offers and announcements' });
    await expect(slider.getByText('Weekend football offer')).toBeVisible();
    const first = slider.getByRole('link', { name: /1 of 2: Weekend football offer/ });
    await expect(first).toHaveAttribute('href', '/explore?type=FOOTBALL_TURF');
    await slider.getByRole('button', { name: 'Banner 2 of 2' }).click();
    await expect(slider.getByText('Hostile link')).toBeVisible();
    // A link that is not a path on this site or an https address is never followed: that banner is just a picture.
    await expect(slider.locator('a[href^="javascript"]')).toHaveCount(0);
  });

  test('with no banners the slider is gone, not an empty box', async ({ page }) => {
    await page.route(`${URLS.api}/banners`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' }, body: '[]' });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Browse by type' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Offers and announcements' })).toHaveCount(0);
  });

  test('the landing page runs with nothing blocked by the content security policy', async ({ page }) => {
    const seen = await scanForViolations(page, ['/']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
