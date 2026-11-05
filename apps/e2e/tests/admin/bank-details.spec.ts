import { ACCOUNTS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** The Super Admin sees a business's bank details in full and verifies them or marks them failed with a reason; the owner sees the result. */
test.describe('admin: bank details', () => {
  test('verify, fail with a reason, and an owner change puts it back to not verified', async ({ page, adminApi, ownerApi }) => {
    const stamp = Date.now().toString().slice(-6);
    const holder = `Admin Check ${stamp}`;
    const number = `7788${stamp}11`;
    const save = async (extra: Record<string, unknown> = {}) =>
      ownerApi.put('/owner/bank-account', {
        data: { accountHolderName: holder, accountNumber: number, ifsc: 'SBIN0004321', bankName: 'State Bank', accountType: 'SAVINGS', password: ACCOUNTS.owner.password, ...extra },
      });
    expect((await save()).ok()).toBeTruthy();

    const orgs = (await (await adminApi.get('/admin/organizations')).json()) as Array<{ id: string }>;
    let orgId = '';
    for (const o of orgs) {
      const b = (await (await adminApi.get(`/admin/organizations/${o.id}/bank-account`)).json()) as { accountHolderName?: string };
      if (b.accountHolderName === holder) orgId = o.id;
    }
    expect(orgId).not.toBe('');

    await page.goto(`/owners/${orgId}`);
    const panel = page;
    await expect(panel.getByText(holder)).toBeVisible();
    await expect(panel.getByText(number)).toBeVisible(); // the admin sees the whole number
    await expect(panel.getByText('SBIN0004321')).toBeVisible();
    await expect(panel.getByText('NOT VERIFIED', { exact: true })).toBeVisible();

    // Fail needs a reason.
    await page.getByRole('button', { name: 'Mark failed' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Mark failed' }).click();
    await expect(dialog.getByText('Say what is wrong, so the owner can fix it.')).toBeVisible();
    await dialog.getByLabel('What is wrong?').fill('Name does not match the bank record');
    await dialog.getByRole('button', { name: 'Mark failed' }).click();
    await expect(page.getByText('Marked failed: Name does not match the bank record')).toBeVisible();
    const owned = (await (await ownerApi.get('/owner/bank-account')).json()) as { status: string; failureReason: string };
    expect(owned).toMatchObject({ status: 'FAILED', failureReason: 'Name does not match the bank record' });

    // The owner corrects it (password again): back to not verified, and now the admin verifies it.
    expect((await save({ accountHolderName: holder })).ok()).toBeTruthy(); // unchanged: stays failed
    expect(((await (await ownerApi.get('/owner/bank-account')).json()) as { status: string }).status).toBe('FAILED');
    expect((await save({ bankName: 'State Bank of India' })).ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByText('NOT VERIFIED', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);
    expect(((await (await ownerApi.get('/owner/bank-account')).json()) as { status: string }).status).toBe('VERIFIED');

    // The owners list shows the state.
    await page.goto('/owners');
    await expect(page.getByRole('columnheader', { name: 'Bank details' })).toBeVisible();
  });
});
