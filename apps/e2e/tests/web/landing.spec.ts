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
    // The nav bar has only Explore venues (no Support link) beside the account menu.
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Explore venues']);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Support' })).toHaveCount(0);
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
    // The card opens the venue's own page (its first unit), where the day and slots are picked.
    await expect(section.getByRole('link', { name: /Greenfield Arena/ })).toHaveAttribute('href', '/book/GRN-1/any');
    await expect(section.getByRole('link', { name: /Blue Lagoon/ })).toHaveAttribute('href', '/book/BLU-2/any');
    await expect(cards.nth(0)).toContainText('Book now');
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

  test('Browse by type is one row that scrolls sideways, with arrows', async ({ page }) => {
    const kinds = Array.from({ length: 12 }, (_, i) => ({ slug: `kind-${i}`, name: `Kind ${i + 1}`, iconKey: 'category', iconSvg: null, imageUrl: null }));
    await page.route(`${URLS.api}/categories?available=true`, (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(kinds) }),
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const cards = page.locator('a[href^="/explore?type="]');
    await expect(cards).toHaveCount(12);
    // All twelve are on a single line (the same top), though they do not all fit across.
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const row = page.getByRole('list').filter({ has: cards.first() });
    expect(await row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    // The arrows page through the row: Previous is off at the start, then Next moves it along.
    const next = page.getByRole('button', { name: 'Next venue types' });
    const prev = page.getByRole('button', { name: 'Previous venue types' });
    await expect(prev).toBeDisabled();
    await next.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    await expect(prev).toBeEnabled();
    // Keep paging (the scroll is animated) until the end of the row is reached.
    await expect(async () => {
      if (await next.isEnabled()) await next.click();
      await expect(next).toBeDisabled({ timeout: 700 });
    }).toPass({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/landing-carousel.png', clip: { x: 0, y: 640, width: 1280, height: 330 } });
  });

  test('the landing page runs with nothing blocked by the content security policy', async ({ page }) => {
    const seen = await scanForViolations(page, ['/']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
