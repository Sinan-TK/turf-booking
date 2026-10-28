import { expect, test } from '../../support/fixtures';
import { unique } from '../../support/env';

/** An organization's logins are paged on the server (25 a time) and searched by name or email. */
test.describe('admin: owner logins paging', () => {
  test('an organization with more than 25 logins pages them, and the search finds one', async ({ page, adminApi }) => {
    test.setTimeout(180_000);
    const tag = unique();
    const org = await adminApi.post('/admin/organizations', {
      data: { name: `PW Pager Org ${tag}`, contactEmail: `pw-pager-org-${tag}@example.com`, contactPhone: '+919999900000' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const orgId = (await org.json()).id as string;
    for (let i = 0; i < 27; i++) {
      const res = await adminApi.post(`/admin/organizations/${orgId}/owner-users`, {
        data: { name: `PW Login ${tag} ${String(i).padStart(2, '0')}`, email: `pw-login-${tag}-${i}@example.com`, role: 'OWNER_ADMIN' },
      });
      expect(res.ok(), `create failed: ${await res.text()}`).toBeTruthy();
    }

    await page.goto(`/owners/${orgId}`);
    await page.getByRole('tab', { name: /^Logins/ }).click();
    await expect(page.getByRole('tab', { name: /^Logins/ })).toHaveAttribute('aria-selected', 'true');
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText('1–25 of 27');
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText('26–27 of 27');

    await page.getByLabel('Search logins').fill(`PW Login ${tag} 05`);
    await expect(page.getByText(`PW Login ${tag} 05`)).toBeVisible();
    await expect(pager).toHaveCount(0);
    await page.getByLabel('Search logins').fill('zzz-nobody-zzz');
    await expect(page.getByText('No logins match your search.')).toBeVisible();
  });
});
