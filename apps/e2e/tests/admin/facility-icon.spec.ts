import { unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

const SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/></svg>';

test.describe('admin: a facility\'s own SVG icon', () => {
  test('a pasted SVG is checked as you type, previewed, saved and can be removed', async ({ page, adminApi }) => {
    const slug = `PW_${unique().toUpperCase()}`;
    const created = await adminApi.post('/admin/categories', {
      data: { slug, name: `PW Icon ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    const stored = async () => ((await (await adminApi.get(`/admin/categories/${id}`)).json()) as { iconSvg: string | null }).iconSvg;

    await page.goto(`/venue-types/${id}`);
    const box = page.getByLabel('Or paste your own SVG');

    // Unsafe markup is refused as soon as it is pasted, with the reason, and saving is blocked.
    await box.fill('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>');
    await expect(page.getByRole('alert').filter({ hasText: 'script' })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(/The icon SVG can't be used/)).toBeVisible();
    expect(await stored()).toBeNull();

    // A good one shows a preview and is saved (tidied: namespace added).
    await box.fill(SVG);
    await expect(page.getByRole('alert').filter({ hasText: 'script' })).toHaveCount(0);
    await expect(page.getByLabel('Preview of your icon').locator('span[style*="mask-image"]')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Facility saved.')).toBeVisible();
    expect(await stored()).toContain('xmlns="http://www.w3.org/2000/svg"');

    // After a reload it is still there, and removing it goes back to the icon name.
    await page.reload();
    await expect(page.getByLabel('Or paste your own SVG')).toHaveValue(/<circle/);
    await page.getByRole('button', { name: 'Remove custom icon' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Facility saved.')).toBeVisible();
    expect(await stored()).toBeNull();
  });
});
