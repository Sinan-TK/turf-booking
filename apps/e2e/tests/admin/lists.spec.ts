import { expect, test } from '../../support/fixtures';

/** Every Super Admin list has a heading, a search box, filter dropdowns, an empty state and "Clear filters". */
const LISTS = [
  { path: '/bookings', heading: 'Bookings', search: 'Search bookings' },
  { path: '/customers', heading: 'Customers', search: 'Search customers' },
  { path: '/owners', heading: 'Owner organizations', search: 'Search organizations' },
  { path: '/payments', heading: 'Payments', search: 'Search payments' },
  { path: '/refunds', heading: 'Refunds', search: 'Search refunds' },
  { path: '/support', heading: 'Support', search: 'Search tickets' },
  { path: '/venues', heading: 'Venues', search: 'Search venues' },
  { path: '/venue-types', heading: 'Facilities', search: 'Search facilities' },
];

test.describe('admin: list pages', () => {
  for (const { path, heading, search } of LISTS) {
    test(`${heading}: loads, searches, shows an empty state and clears`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByLabel(search)).toBeVisible();

      await page.getByLabel(search).fill('zzz-no-such-thing-zzz');
      await expect(page.getByText(/No .*(found|match)/i).first()).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page.getByLabel(search)).toHaveValue('');
      await expect(page.getByText(/No .*(found|match)/i)).toHaveCount(0);
    });

    test(`${heading}: the filter dropdowns open, list their options and close with Escape`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      const dropdown = page.locator('button[aria-haspopup="listbox"]').first();
      await dropdown.click();
      const options = page.getByRole('listbox').getByRole('option');
      expect(await options.count()).toBeGreaterThan(1);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
    });
  }

  test('Venues is paged, 25 at a time', async ({ page }) => {
    await page.goto('/venues');
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText(/1–25 of \d+/);
    await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText(/26–\d+ of \d+/);
    await pager.getByRole('button', { name: 'Previous' }).click();
    await expect(pager).toContainText(/1–25 of \d+/);
  });
});

test.describe('admin: dashboard and reference pages', () => {
  test('the dashboard shows the platform numbers', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByText('A live look at the whole platform.')).toBeVisible();
  });

  for (const [path, heading] of [
    ['/locations', 'Locations'],
    ['/policies', 'Policies & Commissions'],
    ['/announcements', 'Announcements'],
  ] as const) {
    test(`${heading} loads`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    });
  }

  test('the sidebar reaches the main sections', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation');
    for (const [name, url] of [
      ['Bookings', /\/bookings$/],
      ['Customers', /\/customers$/],
      ['Payments', /\/payments$/],
      ['Facilities', /\/venue-types$/],
    ] as const) {
      await nav.getByRole('link', { name }).first().click();
      await expect(page).toHaveURL(url);
    }
  });
});
