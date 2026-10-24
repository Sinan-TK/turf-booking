import { expect, test, type Page } from '@playwright/test';
import { plantEmailCode } from '../../support/customer';
import { logIn } from '../../support/customer-ui';
import { uniquePhone } from '../../support/dates';
import { unique } from '../../support/env';

const PASSWORD = 'PwCustomer123!x';
const CODE = '123456';

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

  test('logging out asks for confirmation first', async ({ page }) => {
    await page.goto('/');
    await logIn(page, uniquePhone(), 'PW Logout Person');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Log out?' });
    await expect(confirm).toBeVisible();
    // It covers the whole page and sits in the middle of the window, not inside the header it was opened from.
    const box = (await confirm.boundingBox())!;
    const view = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(4);
    expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(4);
    expect(box.y).toBeGreaterThan(50);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible(); // still signed in

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await page.getByRole('alertdialog', { name: 'Log out?' }).getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
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

  test('email sign-up needs the emailed code; a wrong code is refused, the right one creates the account', async ({ page }) => {
    const email = `pw-email-${unique()}@example.com`;
    const phone = uniquePhone();
    const dialog = await openDialog(page);
    await dialog.getByRole('tab', { name: /Create account/i }).click();
    await dialog.getByLabel('Your name').fill('PW Email Person');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Phone number').fill(phone.slice(3));
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Create account' }).last().click();

    // Nothing is created yet: the dialog now asks for the code that was emailed.
    await expect(dialog.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
    await dialog.getByLabel('6-digit code').fill('12');
    await dialog.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(dialog.getByText('Enter the 6-digit code.').or(dialog.getByText('The code is 6 digits.'))).toBeVisible();

    await plantEmailCode(email, 'SIGNUP', CODE);
    await dialog.getByLabel('6-digit code').fill('000000');
    await dialog.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(dialog.getByText(/incorrect or has expired/i)).toBeVisible();

    await dialog.getByLabel('6-digit code').fill(CODE);
    await dialog.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
    await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible(); // the emailed code proved the address
  });

  test('forgot password: a wrong password is refused, then an emailed code sets a new one', async ({ page }) => {
    const email = `pw-forgot-${unique()}@example.com`;
    const phone = uniquePhone();
    // An account to start from, made the normal way.
    const dialog = await openDialog(page);
    await dialog.getByRole('tab', { name: /Create account/i }).click();
    await dialog.getByLabel('Your name').fill('PW Forgetful');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Phone number').fill(phone.slice(3));
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Create account' }).last().click();
    await plantEmailCode(email, 'SIGNUP', CODE);
    await dialog.getByLabel('6-digit code').fill(CODE);
    await dialog.getByRole('button', { name: 'Verify and create account' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Signed out; a wrong password gives the generic message.
    await page.context().clearCookies();
    const d2 = await openDialog(page);
    await d2.getByLabel('Email', { exact: true }).fill(email);
    await d2.getByLabel('Password', { exact: true }).fill('WrongPassword1!');
    await d2.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(d2.getByText(/Incorrect email or password/)).toBeVisible();

    // Forgot password: the email, then the code with a new password.
    await d2.getByRole('button', { name: 'Forgot password?' }).click();
    await d2.getByLabel('Email', { exact: true }).fill(email);
    await d2.getByRole('button', { name: 'Email me a code' }).click();
    await expect(d2.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
    await plantEmailCode(email, 'RESET', CODE);

    await d2.getByLabel('6-digit code').fill(CODE);
    await d2.getByLabel('New password').fill('NewPassword456!y');
    await d2.getByLabel('Repeat the password').fill('Different456!y');
    await d2.getByRole('button', { name: 'Set password' }).click();
    await expect(d2.getByText('The two passwords are not the same.')).toBeVisible();

    await d2.getByLabel('Repeat the password').fill('NewPassword456!y');
    await d2.getByRole('button', { name: 'Set password' }).click();
    await expect(d2.getByText('Your password is set.')).toBeVisible();

    await d2.getByLabel('Email', { exact: true }).fill(email);
    await d2.getByLabel('Password', { exact: true }).fill('NewPassword456!y');
    await d2.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
