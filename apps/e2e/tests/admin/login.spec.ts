import { expect, test } from '@playwright/test';
import { ACCOUNTS, URLS } from '../../support/env';

// These tests are about the login page, so they start signed out (an empty state overrides the project's saved login).
test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.admin });

test.describe('admin portal: login page', () => {
  test('a wrong password is refused, the eye button shows it, and the right one signs in', async ({ page }) => {
    const { email, password } = ACCOUNTS.admin;
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    await page.getByPlaceholder('you@company.com').fill(email);
    await page.locator('input[type="password"]').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|too many/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.locator('input[type="text"]').last()).toHaveValue('definitely-not-the-password');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('every page needs a login: a signed-out visit goes to the login page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
