import { expect, test, type Route } from '@playwright/test';
import { logIn } from '../../support/customer-ui';
import { uniquePhone } from '../../support/dates';

/** Holds an API answer back, so the loading state stays on screen long enough to look at. */
const slow = (ms: number) => async (route: Route) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await route.continue().catch(() => undefined);
};

test.describe('customer site: skeleton loading', () => {
  test('the home page shows the shape of the venue cards while the first search runs', async ({ page }) => {
    await page.route('**/search?*', slow(2500));
    await page.goto('/explore');
    const loading = page.getByRole('status').filter({ hasText: 'Checking live availability…' });
    await expect(loading).toBeVisible();
    await expect(loading.locator('.animate-pulse').first()).toBeVisible(); // grey shapes, not a line of text
    expect(await loading.locator('.animate-pulse').count()).toBeGreaterThan(10);
    await expect(loading).toHaveCount(0, { timeout: 20_000 }); // gone once the results (or the empty message) arrive
  });

  test('the account tabs show skeletons while their lists load', async ({ page }) => {
    await page.goto('/explore');
    await logIn(page, uniquePhone(), 'PW Skeleton Person');
    await page.route('**/me/bookings', slow(2500));
    await page.goto('/account?tab=bookings');
    await expect(page.getByRole('status').filter({ hasText: 'Loading your bookings…' })).toBeVisible();
    await expect(page.getByText('No bookings yet.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('status').filter({ hasText: 'Loading your bookings…' })).toHaveCount(0);

    await page.route('**/me/support-tickets', slow(2500));
    await page.goto('/support');
    await expect(page.getByRole('status').filter({ hasText: 'Loading your requests…' })).toBeVisible();
    await expect(page.getByText('No requests yet.')).toBeVisible({ timeout: 20_000 });
  });

  test('the bookings and saved lists show card-shaped skeletons in the same grid as the cards', async ({ page }) => {
    // A signed-in customer (answered by the test) and lists that arrive late, so the placeholders can be measured.
    await page.route('**/customer-auth/me', (route) =>
      route.fulfill({ json: { id: 'c-skeleton', name: 'Skeleton Person', phone: '+919999900001', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false } }),
    );
    await page.route('**/me/bookings', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({ json: [] });
    });
    await page.route('**/me/saved-venues', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({ json: [] });
    });
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const [tab, label] of [['bookings', 'Loading your bookings…'], ['saved', 'Loading your saved venues…']] as const) {
      await page.goto(`/account?tab=${tab}`);
      const loading = page.getByRole('status').filter({ hasText: label });
      await expect(loading).toBeVisible();
      const cards = loading.locator(':scope > div');
      await expect(cards).toHaveCount(4);
      // Four across on a laptop: all on one row, like the real cards.
      const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      expect(await loading.locator('.animate-pulse').count()).toBeGreaterThan(8);
    }

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/account?tab=saved');
    const phone = page.getByRole('status').filter({ hasText: 'Loading your saved venues…' });
    await expect(phone).toBeVisible();
    const tops = await phone.locator(':scope > div').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(4); // one per row on a phone
    await page.screenshot({ path: 'test-results/skeleton-saved-phone.png' });
  });

  test('the checkout page shows a skeleton of its details while it waits for the account', async ({ page }) => {
    await page.route('**/customer-auth/me', slow(2500));
    await page.goto('/checkout/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('status').filter({ hasText: 'Loading your booking…' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Loading your booking…' }).locator('.animate-pulse').first()).toBeVisible();
  });
});
