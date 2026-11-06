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

  test('the logo leads the hero and the nav bar has none', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('img', { name: 'Bookyo' })).toHaveCount(0);
    const hero = page.getByRole('main').getByRole('img', { name: 'Bookyo' }).first();
    await expect(hero).toBeVisible();
    // The logo sits above the headline.
    const logoBox = (await hero.boundingBox())!;
    const headingBox = (await page.getByRole('heading', { name: /Book your game/, level: 1 }).boundingBox())!;
    expect(logoBox.y + logoBox.height).toBeLessThanOrEqual(headingBox.y + 1);
  });

  const cors = { 'content-type': 'application/json', 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' };

  test('featured venues are listed in the admin order with a way to their slots, and the section is gone when none are chosen', async ({ page }) => {
    await page.route(`${URLS.api}/site/featured-venues`, (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify([
          { id: '1', name: 'Greenfield Arena', address: '12 Park Road', area: 'Manjeri', facilityCode: 'GRN-1', photoUrl: null, facilities: ['Football', 'Cricket'] },
          { id: '2', name: 'Blue Lagoon', address: '4 Lake View', area: null, facilityCode: 'BLU-2', photoUrl: null, facilities: [] },
        ]),
      }),
    );
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Featured venues' });
    await expect(section).toBeVisible();
    const cards = section.getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('Greenfield Arena');
    await expect(cards.nth(0)).toContainText('Manjeri');
    await expect(cards.nth(0)).toContainText('Football');
    await expect(cards.nth(1)).toContainText('Blue Lagoon');
    await expect(section.getByRole('link', { name: /Greenfield Arena/ })).toHaveAttribute('href', '/explore?q=Greenfield%20Arena');
  });

  test('with no featured venues there is no empty section', async ({ page }) => {
    await page.route(`${URLS.api}/site/featured-venues`, (route) => route.fulfill({ status: 200, headers: cors, body: '[]' }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Browse by type' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Featured venues' })).toHaveCount(0);
  });

  test('the Google button is on the log in box only while the admin has Google sign-in switched on', async ({ page }) => {
    for (const on of [false, true]) {
      await page.route(`${URLS.api}/site/config`, (route) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ googleSignIn: on }) }));
      await page.goto('/');
      await page.getByRole('button', { name: 'Log in' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Log in or sign up')).toBeVisible();
      await expect(dialog.getByText(on ? /Continue with Google/ : /Use your email and password/).first()).toBeVisible();
      await expect(dialog.getByRole('button', { name: /Google/ })).toHaveCount(on ? 1 : 0);
      await page.unroute(`${URLS.api}/site/config`);
    }
  });

  test('the landing page runs with nothing blocked by the content security policy', async ({ page }) => {
    const seen = await scanForViolations(page, ['/']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
