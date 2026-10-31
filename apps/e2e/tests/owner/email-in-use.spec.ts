import { expect, test } from '@playwright/test';
import { ACCOUNTS, URLS } from '../../support/env';

/** Both forms that create an owner login say, at the email field, when that address already has one (the checks are real requests). */
test.describe('owner portal: an email already in use', () => {
  test.describe('creating an owner account', () => {
    test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.owner });

    test('leaving the email field says so, with the way in, and Continue will not pass it', async ({ page }) => {
      await page.goto('/register');
      await page.getByLabel('Your name').fill('Asha Menon');
      await page.getByLabel('Email').fill(ACCOUNTS.owner.email.toUpperCase());
      await page.getByLabel('Your name').click(); // leaves the email field
      const alert = page.getByRole('alert').filter({ hasText: 'An owner account with this email already exists' });
      await expect(alert).toBeVisible();
      await expect(alert.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
      await expect(alert.getByRole('link', { name: 'reset your password' })).toHaveAttribute('href', '/forgot-password');
      await expect(page.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');

      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('Step 1 of 3')).toBeVisible(); // still on the first step
      await expect(page.getByLabel('Email')).toBeFocused();

      // Another address is free: the message goes and the step moves on.
      await page.getByLabel('Email').fill(`pw-free-${Date.now()}@example.com`);
      await expect(alert).toHaveCount(0);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByText('Step 2 of 3')).toBeVisible();
    });

    test('Continue alone also finds out, without leaving the field first', async ({ page }) => {
      await page.goto('/register');
      await page.getByLabel('Your name').fill('Asha Menon');
      await page.getByLabel('Email').fill(ACCOUNTS.owner.email);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
      await expect(page.getByText('Step 1 of 3')).toBeVisible();
    });
  });

  test.describe('inviting staff', () => {
    test.use({ baseURL: URLS.owner });

    test('the invite form flags an address that is already an owner login', async ({ page }) => {
      await page.goto('/staff');
      await page.getByRole('button', { name: 'Invite staff' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Email').fill(ACCOUNTS.owner.email);
      await dialog.getByLabel('Name').fill('PW Staff');
      await dialog.getByLabel('Name').blur();
      await dialog.getByLabel('Email').focus();
      await dialog.getByLabel('Email').blur();
      await expect(dialog.getByText('An owner login with this email already exists.')).toBeVisible();
    });
  });
});
