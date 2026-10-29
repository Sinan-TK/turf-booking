import { expect, test } from '../../support/fixtures';

/** The owner's own audit log: what their team did and what was done to their venues, shown to the owner admin only. */
test.describe('owner portal: audit log', () => {
  test('the sidebar reaches it, and a venue the owner made is there with who made it', async ({ page, venue }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/audit-log$/);
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

    await page.getByLabel('Search the audit log').fill(venue.id.slice(0, 13));
    const created = page.locator('tbody tr').filter({ hasText: 'Venue created' });
    await expect(created).toHaveCount(1);
    await expect(created).toContainText('owner@turf.local'); // their own person is named
    await expect(created).toContainText('Owner admin');
    await expect(created.getByRole('link', { name: new RegExp(`^${venue.id.slice(0, 8)}`) })).toHaveAttribute('href', `/venues/${venue.id}`);

    // What the platform team did to the venue is shown as the platform team, with no name and no recorded details.
    const platform = page.locator('tbody tr').filter({ hasText: 'The platform team' }).first();
    await expect(platform).toBeVisible();
    await platform.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByText('Details of actions by others are not shown.')).toBeVisible();
    await expect(page.getByText('admin@turf.local')).toHaveCount(0);

    // The owner's own entry opens to what was recorded.
    await created.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('pre')).toBeVisible();
  });

  test('filters narrow the list, clearing them brings it back, and the date filter can empty it', async ({ page, venue }) => {
    await page.goto('/audit-log');
    await page.getByLabel('Search the audit log').fill(venue.id.slice(0, 13));
    await expect(page.locator('tbody tr').first()).toBeVisible();

    await page.locator('label').filter({ hasText: /^By/ }).locator('select').selectOption({ label: 'A customer' });
    await expect(page.getByText('No entries match your search or filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();

    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Date from').fill(tomorrow);
    await expect(page.getByText('No entries match your search or filters.')).toBeVisible();
  });
});
