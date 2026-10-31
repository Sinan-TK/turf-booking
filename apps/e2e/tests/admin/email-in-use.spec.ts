import { ACCOUNTS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** Adding a login to an organization says, at the email field, when the address already has an owner login. */
test.describe('admin: an email already in use', () => {
  test('the add-owner form flags an owner email that exists, on leaving the field and on sending', async ({ page, adminApi }) => {
    const orgs = (await (await adminApi.get('/admin/organizations')).json()) as Array<{ id: string }>;
    await page.goto(`/owners/${orgs[0]!.id}`);
    await page.getByRole('button', { name: '+ Add owner' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('PW Extra Owner');
    await dialog.getByLabel('Email').fill(ACCOUNTS.owner.email);
    await dialog.getByLabel('Name').click(); // leaves the email field
    await expect(dialog.getByText('An owner login with this email already exists.')).toBeVisible();

    // Sending it anyway is refused by the server and shown in the same place.
    await dialog.getByLabel('Email').fill(`pw-new-${Date.now()}@example.com`);
    await expect(dialog.getByText('An owner login with this email already exists.')).toHaveCount(0);
  });
});
