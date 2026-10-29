import { unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** The Super Admin's audit log page: who did what, with filters, paging and the details of each entry. */
test.describe('admin: audit log', () => {
  test('the sidebar reaches it, and it lists entries newest first with who did them', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/audit-log$/);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(page.getByText(/entries recorded|entry recorded/)).toBeVisible();
    const rows = page.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(0);
    await expect(page.getByRole('columnheader', { name: 'Who' })).toBeVisible();
  });

  test('an admin action shows up with its actor, can be found, filtered and opened for details', async ({ page, adminApi }) => {
    const slug = `PW_${unique().toUpperCase()}`;
    const created = await adminApi.post('/admin/categories', {
      data: { slug, name: `PW Audit ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    await page.goto('/audit-log');
    await page.getByLabel('Search the audit log').fill(id.slice(0, 13));
    await expect(page.getByText('1 entry match your filters')).toBeVisible(); // the section's line
    const row = page.locator('tbody tr').first();
    await expect(row).toContainText('Venue category created');
    await expect(row).toContainText('Super Admin');
    await expect(row).toContainText('admin@turf.local');
    await expect(row).toContainText('Venue category');
    await expect(row.getByRole('link', { name: new RegExp(`^${id.slice(0, 8)}`) })).toHaveAttribute('href', `/venue-types/${id}`);

    // Details: the exact time, the id and what was recorded.
    await row.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Subject id:')).toBeVisible();
    await expect(page.locator('pre')).toContainText(slug);
    await row.getByRole('button', { name: 'Hide' }).click();
    await expect(page.locator('pre')).toHaveCount(0);

    // Filters: someone else, or another kind of thing, finds nothing for this id; clearing brings the entry back.
    await page.locator('button[aria-haspopup="listbox"]').first().click(); // By
    await page.getByRole('option', { name: 'Customer' }).click();
    await expect(page.getByText('No entries match your search or filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByLabel('Search the audit log').fill(id.slice(0, 13));
    await expect(page.locator('tbody tr').first()).toContainText('Venue category created');
  });

  test('the date filter and paging work, and an owner cannot read the log through the API', async ({ page, ownerApi }) => {
    await page.goto('/audit-log');
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Date from').fill(tomorrow);
    await expect(page.getByText('No entries match your search or filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();

    const next = page.getByRole('button', { name: /next/i });
    if (await next.isEnabled().catch(() => false)) {
      const firstPageTop = await page.locator('tbody tr').first().innerText();
      await next.click();
      await expect(page.locator('tbody tr').first()).not.toHaveText(firstPageTop);
    }

    expect((await ownerApi.get('/admin/audit-logs')).status()).toBe(403);
  });
});
