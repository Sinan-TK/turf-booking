import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * A sign-up the Super Admin has not approved yet sees only a waiting page. The test is signed in as the real owner, and the answer to "who am I"
 * is changed to say the organization is waiting; once it says "approved" again the real portal appears.
 */
test.use({ baseURL: URLS.owner });

test.describe('owner portal: waiting for approval', () => {
  test('shows only where things stand, can be checked again, and opens the portal once approved', async ({ page }) => {
    let pending = true;
    let asked = 0;
    await page.route(`${URLS.api}/auth/owner/me`, async (route) => {
      if (route.request().method() !== 'GET' || !pending) return route.continue();
      asked += 1;
      const res = await route.fetch();
      const me = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...me, organizationStatus: 'PENDING_APPROVAL', organizationName: 'PW New Sports Hub', venues: [] } });
    });

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    await expect(page.getByText('PW New Sports Hub')).toBeVisible();
    await expect(page.getByText('Our team reviews it')).toBeVisible();
    await expect(page.getByText('In progress')).toBeVisible();
    // Nothing of the real portal is there: no menu, no dashboard.
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Venue Partner Terms' })).toHaveAttribute('href', '/partner-terms');

    // "Check again" asks, and while it is still waiting it says so.
    const before = asked;
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('status')).toContainText('Still waiting');
    expect(asked).toBeGreaterThan(before);

    // Approved: the same button opens the real portal.
    pending = false;
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('a waiting owner can sign out', async ({ page }) => {
    await page.route(`${URLS.api}/auth/owner/me`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const me = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...me, organizationStatus: 'PENDING_APPROVAL', venues: [] } });
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    // (the saved test login is ended by this; the next test run signs in again)
  });
});
