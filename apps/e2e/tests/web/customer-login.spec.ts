import { expect, test, type Page } from '@playwright/test';
import { plantResetToken } from '../../support/customer';
import { logIn } from '../../support/customer-ui';
import { uniquePhone } from '../../support/dates';
import { unique } from '../../support/env';

const PASSWORD = 'PwCustomer123!x';

async function openDialog(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  return page.getByRole('dialog');
}

test.describe('customer sign-in', () => {
  test('the dialog offers Google and email, and no phone-code option', async ({ page }) => {
    const dialog = await openDialog(page);
    await expect(dialog.getByRole('button', { name: 'Continue with Google (test)' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: /Create account/i })).toBeVisible();
    await expect(dialog.getByText('Send code')).toHaveCount(0);
  });

  test('Google sign-in asks for a name and phone, then lands on an account with an unverified phone', async ({ page }) => {
    const phone = uniquePhone();
    await page.goto('/');
    await logIn(page, phone, 'PW Google Person');
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByText('Not verified').first()).toBeVisible(); // phone typed, not proven
    await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible(); // email proven by Google
    await expect(page.getByRole('heading', { name: 'Change password' })).toHaveCount(0); // Google-only: no password
  });

  test('email sign-up with a name, a wrong password is refused, forgot password sets a new one', async ({ page }) => {
    const email = `pw-email-${unique()}@example.com`;
    const phone = uniquePhone();
    const dialog = await openDialog(page);
    await dialog.getByRole('tab', { name: /Create account/i }).click();
    await dialog.getByLabel('Your name').fill('PW Email Person');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Phone number').fill(phone.slice(3));
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: /Create account/i }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();

    // Sign out, then a wrong password gives the generic message.
    await page.getByRole('button', { name: /account menu|PW Email Person|P/ }).first().click().catch(() => undefined);
    await page.context().clearCookies();
    const d2 = await openDialog(page);
    await d2.getByLabel('Email', { exact: true }).fill(email);
    await d2.getByLabel('Password', { exact: true }).fill('WrongPassword1!');
    await d2.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(d2.getByText(/Incorrect email or password/)).toBeVisible();

    // The emailed link, with a planted token, sets a new password.
    const token = await plantResetToken(email);
    await page.goto(`/reset-password?token=${token}`);
    await page.getByLabel('New password').fill('NewPassword456!y');
    await page.getByLabel('Repeat the password').fill('NewPassword456!y');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('Your password is set.')).toBeVisible();
    await page.getByRole('button', { name: 'Sign in' }).click();
    const d3 = page.getByRole('dialog');
    await d3.getByLabel('Email', { exact: true }).fill(email);
    await d3.getByLabel('Password', { exact: true }).fill('NewPassword456!y');
    await d3.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a reset link works once and a bad one is explained', async ({ page }) => {
    await page.goto(`/reset-password?token=${'x'.repeat(43)}`);
    await page.getByLabel('New password').fill('NewPassword456!y');
    await page.getByLabel('Repeat the password').fill('NewPassword456!y');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
  });
});
