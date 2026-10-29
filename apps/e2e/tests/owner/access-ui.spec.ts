import { createStaff } from '../../support/staff';
import { expect, test } from '../../support/fixtures';

/** The staff page explains what staff can do; staff see their own access, and are told why a page is not theirs. */
test.describe('owner portal: owner and staff access, in words', () => {
  test('the staff page says what staff can and cannot do, and lists each person by sign-in state and venues', async ({ page, ownerApi, venue }) => {
    const staff = await createStaff(ownerApi, [venue.id], 'Guide');
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'What staff can do' })).toBeVisible();
    await expect(page.getByText('Take walk-in bookings')).toBeVisible();
    await expect(page.getByText('Earnings and payments')).toBeVisible();

    await page.getByLabel('Search staff').fill(staff.email);
    const row = page.getByRole('row').filter({ hasText: staff.email });
    await expect(row).toContainText('Active');
    await expect(row).toContainText(venue.name);
    // The guide steps aside once the list is being searched.
    await expect(page.getByRole('heading', { name: 'What staff can do' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Disable' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click();
    await expect(row).toContainText('Disabled');
    await expect(row).toContainText('Cannot sign in');
  });

  test('staff see their access on the dashboard and settings, and a page that is not theirs explains itself', async ({ browser, ownerApi, venue }) => {
    test.setTimeout(120_000);
    const staff = await createStaff(ownerApi, [venue.id], 'Access');
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto('/login');
    await p.getByPlaceholder('you@company.com').fill(staff.email);
    await p.locator('input[type="password"]').fill(staff.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p.getByRole('heading', { name: `Today at ${venue.name}` })).toBeVisible();

    await expect(p.getByText('Working in', { exact: true })).toBeVisible();
    await expect(p.getByRole('heading', { name: 'What you can do here' })).toBeVisible();
    await expect(p.getByLabel('Your venues').getByText(venue.name)).toBeVisible();

    // A page for the owner admin: sent back to the dashboard, with the reason.
    await p.goto('/earnings');
    await expect(p).toHaveURL(/\/dashboard\?restricted=1$/);
    await expect(p.getByRole('status')).toContainText('That page is for the owner admin');
    await p.getByRole('button', { name: 'Dismiss' }).click();
    await expect(p.getByRole('status')).toHaveCount(0);

    await p.goto('/settings');
    await expect(p.getByText('Staff', { exact: true }).first()).toBeVisible();
    await expect(p.getByText(staff.email)).toBeVisible();
    await expect(p.getByText('Your venues')).toBeVisible();
    await ctx.close();
  });
});
