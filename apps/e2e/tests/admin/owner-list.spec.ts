import { expect, test } from '../../support/fixtures';

/** The owners list shows the business, the owner's name and the number of active venues, and can be searched by the owner's name. */
test.describe('admin: owner list columns', () => {
  test('has Business, Owner and Active venues columns, and finds an owner by name', async ({ page, adminApi }) => {
    const rows = (await (await adminApi.get('/admin/organizations')).json()) as Array<{ id: string; name: string; ownerName: string | null; activeVenues: number }>;
    const withOwner = rows.find((r) => r.ownerName)!;
    await page.goto('/owners');
    for (const heading of ['Business', 'Owner', 'Active venues']) await expect(page.getByRole('columnheader', { name: new RegExp(heading) })).toBeVisible();

    await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill(withOwner.ownerName!);
    const row = page.getByRole('row').filter({ hasText: withOwner.name }).first();
    await expect(row).toContainText(withOwner.ownerName!);
    await expect(row.getByRole('cell').nth(3)).toHaveText(String(withOwner.activeVenues));
  });
});
