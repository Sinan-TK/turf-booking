import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';

/** Someone who is already signed in has no use for the sign-in pages: they go straight to the portal. */
test.describe('owner portal: sign-in pages when already signed in', () => {
  for (const path of ['/login', '/forgot-password']) {
    test(`${path} sends a signed-in owner to the dashboard`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);
    });
  }

  test('going back to the sign-in page after signing in leads back to the portal, and signed out they still see the form', async ({ page, browser }) => {
    await page.goto('/dashboard');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);

    const signedOut = await browser.newContext({ baseURL: URLS.owner, storageState: { cookies: [], origins: [] } });
    const visitor = await signedOut.newPage();
    await visitor.goto('/login');
    await expect(visitor.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await visitor.goto('/forgot-password');
    await expect(visitor).toHaveURL(/\/forgot-password$/);
    await signedOut.close();
  });
});
