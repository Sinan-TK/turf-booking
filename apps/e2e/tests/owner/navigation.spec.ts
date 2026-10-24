import { expect, test } from '../../support/fixtures';
import { ACCOUNTS, URLS } from '../../support/env';

test.describe('owner portal: shell and dashboard', () => {
  test('the dashboard shows the summary cards, recent bookings and quick actions', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    for (const label of ['My Venues', 'Active Venues', 'Bookings Today', 'Revenue This Month']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Recent bookings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
    await page.getByRole('link', { name: /Add a venue/ }).click();
    await expect(page).toHaveURL(/\/venues\/new$/);
  });

  test('the sidebar reaches every section', async ({ page }) => {
    await page.goto('/dashboard');
    const sections: Array<[RegExp, RegExp, string]> = [
      [/My Venues/, /\/venues$/, 'My Venues'],
      [/Bookings/, /\/bookings$/, 'Bookings'],
      [/Notifications/, /\/notifications$/, 'Notifications'],
      [/Payments/, /\/payments$/, 'Payments'],
      [/Refunds/, /\/refunds$/, 'Refunds'],
      [/Settings/, /\/settings$/, 'Settings'],
    ];
    for (const [link, url, heading] of sections) {
      await page.getByRole('navigation').getByRole('link', { name: link }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
  });

  test('an unknown signed-in visitor is sent to the login page, and logging out ends the session', async ({ browser }) => {
    // A brand-new browser context has no session.
    // An empty storageState overrides the project's saved login.
    const anon = await browser.newContext({ baseURL: URLS.owner, storageState: { cookies: [], origins: [] } });
    const page = await anon.newPage();
    await page.goto('/venues');
    await expect(page).toHaveURL(/\/login/);

    await page.getByPlaceholder('you@company.com').fill(ACCOUNTS.owner.email);
    await page.locator('input[type="password"]').fill(ACCOUNTS.owner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // Logging out asks first: Cancel keeps the session, Log out ends it.
    await page.getByRole('button', { name: /Log out/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Log out?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);
    await page.getByRole('button', { name: /Log out/ }).click();
    await page.getByRole('alertdialog', { name: 'Log out?' }).getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/venues');
    await expect(page).toHaveURL(/\/login/);
    await anon.close();
  });
});
