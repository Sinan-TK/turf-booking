import { expect, test } from '../../support/fixtures';

/** Settings → Change Password asks for the new password twice. (The dev password itself is never changed here.) */
test.describe('owner portal: change password', () => {
  test('the new password must be typed twice, the same both times', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel('Current Password').fill('whatever-current');
    await page.getByLabel('New Password', { exact: true }).fill('Brand-new-pass-1');
    await page.getByLabel('Confirm New Password').fill('Brand-new-pass-2');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('The two new passwords do not match.')).toBeVisible();

    await page.getByLabel('Confirm New Password').fill('');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('The two new passwords do not match.')).toBeVisible();

    // Matching, but the current password is wrong: the server refuses and nothing changes.
    await page.getByLabel('Confirm New Password').fill('Brand-new-pass-1');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('The two new passwords do not match.')).toHaveCount(0);
    await expect(page.getByRole('alert').or(page.getByText(/current password|Failed to change/i)).first()).toBeVisible();
  });
});
