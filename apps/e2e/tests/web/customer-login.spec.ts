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

  test('the account menu has a Profile option that opens the profile', async ({ page }) => {
    await page.goto('/');
    await logIn(page, uniquePhone(), 'PW Menu Person');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.slice(0, 4)).toEqual(['Profile', 'Bookings', 'Wallet (Coins)', 'Support']);
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page).toHaveURL(/\/account\?tab=profile$/);
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeInViewport();
    // Shown as text, with an Edit button; Edit opens fields and Cancel closes them again.
    await expect(page.getByText('PW Menu Person')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Name')).toHaveValue('PW Menu Person');
    await page.getByLabel('Name').fill('Changed but cancelled');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText('PW Menu Person')).toBeVisible();
    await expect(page.getByText('Changed but cancelled')).toHaveCount(0);
  });

  test('the phone field shows the flag and +91 outside the box and holds only the ten digits, with Indian number rules', async ({ page }) => {
    const phone = uniquePhone();
    await page.goto('/');
    await logIn(page, phone, 'PW Phone Person');
    await page.goto('/account?tab=profile');
    await expect(page.getByText(`+91 ${phone.slice(3, 8)} ${phone.slice(8)}`)).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();

    const field = page.locator('#account-phone');
    await expect(field).toHaveValue(phone.slice(3)); // no +91 inside the box
    await expect(page.getByLabel('India, country code 91')).toHaveText('+91');
    await field.fill('');
    await field.fill('+91 98765 43210abc'); // as if pasted
    await expect(field).toHaveValue('9876543210'); // digits only, country code dropped
    await field.fill('');
    await field.pressSequentially('98765432109999');
    await expect(field).toHaveValue('9876543210'); // never more than ten

    const save = page.getByRole('button', { name: 'Save' });
    await field.fill('98765');
    await save.click();
    await expect(page.getByText('Enter the full 10-digit mobile number.')).toBeVisible();
    await field.fill('5876543210');
    await save.click();
    await expect(page.getByText('Indian mobile numbers start with 6, 7, 8 or 9.')).toBeVisible();
    await field.fill('9999999999');
    await save.click();
    await expect(page.getByText('Enter a real mobile number.')).toBeVisible();

    const fresh = '9' + String(Math.floor(100_000_000 + Math.random() * 899_999_999));
    await field.fill(fresh);
    await save.click();
    const toast = page.getByRole('status').filter({ hasText: 'Profile saved.' });
    await expect(toast).toBeVisible(); // a toast at the bottom middle, not a banner that stays
    const box = (await toast.boundingBox())!;
    const view = page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(8);
    expect(box.y).toBeGreaterThan(view.height * 0.7);
    await expect(page.getByText(`+91 ${fresh.slice(0, 5)} ${fresh.slice(5)}`)).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 8000 });
  });

  test('the sign-up form takes the phone the same way', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: /Create account/i }).click();
    await expect(dialog.getByLabel('India, country code 91')).toHaveText('+91');
    await dialog.getByLabel('Phone number').fill('1234567890');
    await dialog.getByLabel('Your name').fill('PW Rules');
    await dialog.getByLabel('Email', { exact: true }).fill(`pw-rules-${unique()}@example.com`);
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Create account' }).last().click();
    await expect(dialog.getByText('Indian mobile numbers start with 6, 7, 8 or 9.')).toBeVisible();
  });

  test('the account page has a curved-box back button, no Home text, no header menu, and a Log out with confirmation', async ({ page }) => {
    await page.goto('/');
    await logIn(page, uniquePhone(), 'PW Account Person');
    // The back button goes back to the page the visitor came from.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page).toHaveURL(/localhost:\d+\/$/);

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();

    const back = page.getByRole('button', { name: 'Go back' });
    await expect(back).toBeVisible();
    const box = (await back.boundingBox())!;
    expect(Math.round(box.width)).toBe(Math.round(box.height)); // square
    expect(await back.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('12px'); // a curved box, not a circle
    await expect(page.getByText('Home', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account menu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0);

    // Edit stands out: a solid green button, not a plain outline.
    const editColour = await page.getByRole('button', { name: 'Edit' }).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(editColour).not.toBe('rgb(255, 255, 255)');
    expect(editColour).toBe('rgb(4, 120, 87)');

    // Log out sits in the top right corner, on the back button's row, where the profile icon used to be.
    const logout = page.getByRole('button', { name: 'Log out' });
    const out = (await logout.boundingBox())!;
    const bk = (await back.boundingBox())!;
    const view = page.viewportSize()!;
    expect(Math.abs(out.y + out.height / 2 - (bk.y + bk.height / 2))).toBeLessThan(6);
    expect(out.x).toBeGreaterThan(view.width / 2); // on the right, opposite the back button
    await logout.click();
    const confirm = page.getByRole('alertdialog', { name: 'Log out?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible(); // still signed in

    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('alertdialog', { name: 'Log out?' }).getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByText('Log in to see your account.')).toBeVisible();
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
    // Four tabs. A Google-only customer has no password, so Profile offers no Change password.
    await expect(page.getByRole('tab')).toHaveText(['Profile', 'Wallet', 'Bookings', 'Support']);
    await expect(page.getByRole('heading', { name: 'Change password' })).toHaveCount(0);
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
    await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible(); // the emailed code proved the address
    await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible(); // in Profile, for an account with a password
    await expect(page.getByLabel('Current password')).toHaveCount(0); // closed until Change is pressed
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New password', { exact: true }).fill('BrandNew456!y');
    await page.getByLabel('Repeat the new password').fill('BrandNew456!y');
    await page.getByRole('button', { name: 'Update password' }).click();
    const done = page.getByRole('status').filter({ hasText: 'Password changed' });
    await expect(done).toBeVisible();
    await expect(page.getByLabel('Current password')).toHaveCount(0);
    await expect(done).toHaveCount(0, { timeout: 8000 }); // the message fades away by itself
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
