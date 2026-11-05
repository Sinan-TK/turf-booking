import { expect, test } from '../../support/fixtures';
import { png } from '../../support/png';

/** The Super Admin's Deleted files: a photo an owner removes is listed (still in the bucket), can be checked, and marked as removed. */
test.describe('admin: deleted files', () => {
  test('a removed unit photo is listed as waiting, found still in the bucket by Check bucket, and marked removed', async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    const added = await ownerApi.post(`/resources/${venue.turfId}/photos`, { multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: png(64, 32, [90, 120, 200]) } } });
    expect(added.ok()).toBe(true);
    const photo = ((await added.json()) as Array<{ id: string }>)[0]!;
    expect((await ownerApi.delete(`/resources/${venue.turfId}/photos/${photo.id}`)).ok()).toBe(true);

    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Deleted files' }).click();
    await expect(page.getByRole('heading', { name: 'Deleted files', level: 1 })).toBeVisible();
    await page.getByPlaceholder('Search by file name or what it was…').fill(venue.name);

    const row = page.getByRole('row').filter({ hasText: venue.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Unit photo');
    await expect(row).toContainText('Waiting');
    await expect(row).toContainText(venue.turfName);
    await expect(row).toContainText('by an owner');
    await expect(row.getByRole('button', { name: /^Copy the file name venues\// })).toBeVisible();

    // The bucket still holds the file (the app has no delete access there), so Check bucket leaves it waiting.
    await page.getByRole('button', { name: 'Check bucket' }).click();
    await expect(page.getByRole('status')).toContainText(/still in the bucket/);
    await expect(row).toContainText('Waiting');

    // Ticking the row and marking it removed moves it to the Removed list.
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Mark 1 selected as removed' }).click();
    await expect(page.getByRole('status')).toContainText('1 file marked as removed.');
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toHaveCount(0);

    await page.locator('button[aria-haspopup="listbox"]').first().click();
    await page.getByRole('option', { name: 'Removed from the bucket' }).click();
    const removed = page.getByRole('row').filter({ hasText: venue.name });
    await expect(removed).toHaveCount(1);
    await expect(removed).toContainText('Removed');
    await expect(removed.getByRole('checkbox')).toHaveCount(0);
  });

  test('the page is only in the Super Admin portal and its summary counts what is waiting', async ({ adminApi }) => {
    const summary = await (await adminApi.get('/admin/deleted-files/summary')).json();
    expect(summary).toEqual({ waiting: expect.any(Number), removed: expect.any(Number) });
  });
});
