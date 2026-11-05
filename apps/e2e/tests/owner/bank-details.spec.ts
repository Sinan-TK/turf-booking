import { ACCOUNTS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** The owner admin's bank details: masked once saved, changed only with the password, and back to "not verified" after every change. */
test.describe('owner portal: bank details', () => {
  test('add details, see them masked, and a change needs the right password', async ({ page }) => {
    const stamp = Date.now().toString().slice(-6);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Bank details for payouts' })).toBeVisible();

    await page.getByRole('button', { name: /Add bank details|Change bank details/ }).click();
    // An empty form (the saved name and bank are cleared if an earlier run left them): every field explains itself.
    await page.getByLabel('Account holder name').fill('');
    await page.getByLabel('IFSC code').fill('');
    await page.getByLabel('Bank name').fill('');
    await page.getByRole('button', { name: 'Save bank details' }).click();
    await expect(page.getByText('Enter the account holder name.')).toBeVisible();
    await expect(page.getByText('The account number is 9 to 18 digits.')).toBeVisible();
    await expect(page.getByText('Enter a valid IFSC code, like HDFC0001234.')).toBeVisible();
    await expect(page.getByText('Enter your password to save.')).toBeVisible();

    await page.getByLabel('Account holder name').fill(`Greenfield ${stamp}`);
    await page.getByLabel('Account number', { exact: true }).fill(`4455${stamp}00`);
    await page.getByLabel('Confirm account number').fill('111111111111');
    await page.getByLabel('IFSC code').fill('hdfc0001234');
    await page.getByLabel('Bank name').fill('HDFC Bank');
    await page.getByLabel('Your password').fill('whatever');
    await page.getByRole('button', { name: 'Save bank details' }).click();
    await expect(page.getByText('The two account numbers do not match.')).toBeVisible();

    // A wrong password: refused, nothing saved, the form stays open.
    await page.getByLabel('Confirm account number').fill(`4455${stamp}00`);
    await page.getByRole('button', { name: 'Save bank details' }).click();
    await expect(page.getByText(/password is not right/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save bank details' })).toBeVisible();

    // The right password saves it.
    await page.getByLabel('Your password').fill(ACCOUNTS.owner.password);
    await page.getByRole('button', { name: 'Save bank details' }).click();
    await expect(page.getByText(/Saved\. Bookyo will check/)).toBeVisible();
    await expect(page.getByText(`Greenfield ${stamp}`)).toBeVisible();
    await expect(page.getByText(`••••••••${`${stamp}00`.slice(-4)}`)).toBeVisible();
    await expect(page.getByText(`4455${stamp}00`)).toHaveCount(0);
    await expect(page.getByText('HDFC0001234')).toBeVisible();
    await expect(page.getByText('NOT VERIFIED', { exact: true })).toBeVisible();
  });
});
