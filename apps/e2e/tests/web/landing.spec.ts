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
          { id: '1', name: 'Greenfield Arena', address: '12 Park Road', area: 'Manjeri', facilityCode: 'GRN-1', photoUrls: [], icon: { iconKey: 'sports_soccer', iconSvg: null }, facilities: ['Football', 'Cricket'] },
          { id: '2', name: 'Blue Lagoon', address: '4 Lake View', area: null, facilityCode: 'BLU-2', photoUrls: [], icon: null, facilities: [] },
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

  const square = (colour: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${colour}"/></svg>`)}`;

  test('a featured card with no picture shows its facility icon; with several it turns through them by itself', async ({ page }) => {
    await page.route(`${URLS.api}/site/featured-venues`, (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify([
          { id: '1', name: 'No Photo Venue', address: '1 Road', area: null, facilityCode: 'NPV-1', photoUrls: [], icon: { iconKey: 'pool', iconSvg: null }, facilities: ['Swimming Pool'] },
          { id: '2', name: 'One Photo Venue', address: '2 Road', area: null, facilityCode: 'OPV-2', photoUrls: [square('#c33')], icon: null, facilities: [] },
          { id: '3', name: 'Many Photo Venue', address: '3 Road', area: null, facilityCode: 'MPV-3', photoUrls: [square('#c33'), square('#3c3'), square('#33c')], icon: null, facilities: [] },
        ]),
      }),
    );
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Featured venues' });
    const card = (name: string) => section.getByRole('listitem').filter({ hasText: name });

    // No picture: the venue type's own icon, not an empty box.
    await expect(card('No Photo Venue').locator('img')).toHaveCount(0);
    await expect(card('No Photo Venue').locator('.material-symbols-outlined, svg').first()).toBeVisible();

    // One picture stays put and has no dots.
    await expect(card('One Photo Venue').locator('img')).toHaveCount(1);
    await expect(card('One Photo Venue').getByRole('img', { name: /picture \d of/ })).toHaveCount(0);

    // Several: it moves on by itself, round to the first again.
    const many = card('Many Photo Venue');
    const which = () => many.getByRole('img', { name: /picture \d of 3/ }).getAttribute('aria-label');
    expect(await which()).toContain('picture 1 of 3');
    await expect.poll(which, { timeout: 8000 }).toContain('picture 2 of 3');
    await expect.poll(which, { timeout: 8000 }).toContain('picture 3 of 3');
    await expect.poll(which, { timeout: 8000 }).toContain('picture 1 of 3');
    // The picture shown is the opaque one.
    await expect(many.locator('img:not([aria-hidden="true"])')).toHaveCount(1);
  });

  test('the facility icon shows while a picture is loading (and if it never loads), then the picture fades in', async ({ page }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#3c3"/></svg>';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // The picture is served from this site (the page only loads its own pictures) but is held back until the test lets it through.
    await page.route(`${URLS.web}/slow-photo.svg`, async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
    });
    await page.route(`${URLS.web}/missing-photo.svg`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(`${URLS.api}/site/featured-venues`, (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify([
          { id: '1', name: 'Slow Picture Venue', address: '1 Road', area: null, facilityCode: 'SPV-1', photoUrls: ['/slow-photo.svg'], icon: { iconKey: 'pool', iconSvg: null }, facilities: [] },
          { id: '2', name: 'Broken Picture Venue', address: '2 Road', area: null, facilityCode: 'BPV-2', photoUrls: ['/missing-photo.svg'], icon: { iconKey: 'pool', iconSvg: null }, facilities: [] },
        ]),
      }),
    );
    await page.goto('/');
    const section = page.getByRole('region', { name: 'Featured venues' });
    const slow = section.getByRole('listitem').filter({ hasText: 'Slow Picture Venue' });
    const broken = section.getByRole('listitem').filter({ hasText: 'Broken Picture Venue' });
    const iconLayer = (card: typeof slow) => card.locator('span.absolute.inset-0.flex.items-center.justify-center').first();
    const opacity = (card: typeof slow) => iconLayer(card).evaluate((el) => getComputedStyle(el).opacity);

    // While it loads: the icon is there and the picture is not shown.
    await expect(slow).toBeVisible();
    expect(await opacity(slow)).toBe('1');
    expect(await slow.locator('img').evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    // A picture that fails to load leaves the icon.
    await expect.poll(() => opacity(broken)).toBe('1');

    // Once it has arrived, the picture takes over from the icon.
    release();
    await expect.poll(() => opacity(slow), { timeout: 8000 }).toBe('0');
    await expect.poll(() => slow.locator('img').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8000 }).toBe('1');
    expect(await opacity(broken)).toBe('1');
  });

  test('a venue type card shows its icon while its picture loads, and keeps it if the picture never loads', async ({ page }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#3c3"/></svg>';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${URLS.web}/slow-type.svg`, async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
    });
    await page.route(`${URLS.web}/missing-type.svg`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(`${URLS.api}/categories?available=true`, (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        body: JSON.stringify([
          { slug: 'slow', name: 'Slow Type', iconKey: 'sports_soccer', iconSvg: null, imageUrl: '/slow-type.svg' },
          { slug: 'broken', name: 'Broken Type', iconKey: 'pool', iconSvg: null, imageUrl: '/missing-type.svg' },
        ]),
      }),
    );
    await page.goto('/');
    const slow = page.locator('a[href="/explore?type=slow"]');
    const broken = page.locator('a[href="/explore?type=broken"]');
    const photo = (card: typeof slow) => card.locator('img').evaluate((el) => getComputedStyle(el).opacity);
    await expect(slow).toBeVisible();
    // Loading: the picture is not shown (so the icon behind it is).
    expect(await photo(slow)).toBe('0');
    // Never loads: still not shown, so no broken-picture mark.
    await expect.poll(() => photo(broken)).toBe('0');
    release();
    await expect.poll(() => photo(slow), { timeout: 8000 }).toBe('1');
    expect(await photo(broken)).toBe('0');
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
