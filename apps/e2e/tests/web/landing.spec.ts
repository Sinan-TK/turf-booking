import { expect, test } from '@playwright/test';
import { scanForViolations } from '../../support/csp';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

/** The landing page at "/" (search, venue types, how it works) and the venue listing now at "/explore". */
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

  test('there is no advertising section: the page goes from the search and venue types to how it works', async ({ page }) => {
    let askedForBanners = false;
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/banners') askedForBanners = true;
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Browse by type' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('region', { name: /Offers/ })).toHaveCount(0);
    expect(askedForBanners).toBe(false);
  });

  test('the landing page runs with nothing blocked by the content security policy', async ({ page }) => {
    const seen = await scanForViolations(page, ['/']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
