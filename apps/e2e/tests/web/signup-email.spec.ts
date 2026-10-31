import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

const cors = { 'content-type': 'application/json', 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' };

/** The customer sign-up form says, as soon as the email field is left, that the address already has an account, and offers the way in. */
test.describe('customer site: an email already in use', () => {
  test('the sign-up form flags it and offers Sign in and Forgot password; a free address shows nothing', async ({ page }) => {
    await page.route(`${URLS.api}/customer-auth/email-check`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const { email } = route.request().postDataJSON() as { email: string };
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ available: !email.toLowerCase().startsWith('taken') }) });
    });
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Log in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Create account' }).click();

    await dialog.getByLabel('Email', { exact: true }).fill('Taken.Person@Example.com');
    await dialog.getByLabel('Your name').click(); // leaves the email field
    const alert = dialog.getByRole('alert').filter({ hasText: 'This email already has an account' });
    await expect(alert).toBeVisible();

    await dialog.getByLabel('Email', { exact: true }).fill('free.person@example.com');
    await expect(alert).toHaveCount(0);
    await dialog.getByLabel('Your name').click();
    await expect(dialog.getByText('already has an account')).toHaveCount(0);

    // The way in: back to Sign in with the address kept, or the password reset.
    await dialog.getByLabel('Email', { exact: true }).fill('taken.person@example.com');
    await dialog.getByLabel('Your name').click();
    await alert.getByRole('button', { name: 'Sign in' }).click();
    await expect(dialog.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveValue('taken.person@example.com');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
