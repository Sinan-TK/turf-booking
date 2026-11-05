import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { png } from '../../support/png';
import type { PwVenue } from '../../support/api';

/**
 * The Super Admin's Deleted files. What a removed photo looks like depends on the API's STORAGE_DELETE_FILES setting:
 *  - off (the bucket key cannot delete): the file stays in the bucket and waits on the list for a hand delete;
 *  - on (the key can delete): the API deletes it at once and the list shows it already removed.
 * Each mode has its own test; the one that does not match how the API is running is skipped.
 */
const SEARCH = 'Search by file name or what it was…';

async function removePhoto(venue: PwVenue, ownerApi: APIRequestContext, adminApi: APIRequestContext) {
  const added = await ownerApi.post(`/resources/${venue.turfId}/photos`, { multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: png(64, 32, [90, 120, 200]) } } });
  expect(added.ok()).toBe(true);
  const photo = ((await added.json()) as Array<{ id: string }>)[0]!;
  expect((await ownerApi.delete(`/resources/${venue.turfId}/photos/${photo.id}`)).ok()).toBe(true);
  const rows = (await (await adminApi.get(`/admin/deleted-files?status=all&search=${encodeURIComponent(venue.name)}`)).json()) as Array<{ id: string; removedAt: string | null }>;
  expect(rows).toHaveLength(1);
  return { id: rows[0]!.id, deletedAtOnce: rows[0]!.removedAt !== null };
}

async function openList(page: Page, venue: PwVenue) {
  await page.goto('/dashboard');
  await page.getByRole('navigation').getByRole('link', { name: 'Deleted files' }).click();
  await expect(page.getByRole('heading', { name: 'Deleted files', level: 1 })).toBeVisible();
  await page.getByPlaceholder(SEARCH).fill(venue.name);
}

const pickStatus = async (page: Page, option: string) => {
  await page.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole('option', { name: option }).click();
};

test.describe('admin: deleted files', () => {
  test('files the API cannot delete wait on the list, stay while still in the bucket, and can be cleared to Removed', async ({ page, makeVenue, ownerApi, adminApi }) => {
    const venue = await makeVenue();
    const photo = await removePhoto(venue, ownerApi, adminApi);
    test.skip(photo.deletedAtOnce, 'the API deletes files itself (STORAGE_DELETE_FILES is on)');

    await openList(page, venue);
    const row = page.getByRole('row').filter({ hasText: venue.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Unit photo');
    await expect(row).toContainText('Waiting');
    await expect(row).toContainText(venue.turfName);
    await expect(row).toContainText('by an owner');
    await expect(row.getByRole('button', { name: /^Copy the file name venues\// })).toBeVisible();

    // The bucket still holds the file, so Check bucket leaves it waiting. Nothing is ticked or marked by hand.
    await page.getByRole('button', { name: 'Check bucket' }).click();
    await expect(page.getByRole('status').filter({ hasText: /still in the bucket/ })).toBeVisible();
    await expect(row).toContainText('Waiting');
    await expect(row.getByRole('checkbox')).toHaveCount(0);

    // Confirmed removed (the API's own record of it) the file moves to Removed.
    await adminApi.post(`/admin/deleted-files/${photo.id}/removed`);
    await page.reload();
    await page.getByPlaceholder(SEARCH).fill(venue.name);
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toHaveCount(0);
    await pickStatus(page, 'Removed from the bucket');
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toContainText('Removed');

    // Marked removed but in fact still in the bucket: Check bucket puts it back on the waiting list.
    await page.getByRole('button', { name: 'Check bucket' }).click();
    await expect(page.getByRole('status').filter({ hasText: /put back on the waiting list/ })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toHaveCount(0);
    await pickStatus(page, 'Waiting to be deleted');
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toContainText('Waiting');
  });

  test('when the API deletes files itself, a removed photo is gone from the bucket and shows under Removed at once', async ({ page, makeVenue, ownerApi, adminApi, request }) => {
    const venue = await makeVenue();
    const added = await ownerApi.post(`/resources/${venue.turfId}/photos`, { multipart: { file: { name: 'p.png', mimeType: 'image/png', buffer: png(64, 32, [200, 90, 40]) } } });
    const photo = ((await added.json()) as Array<{ id: string; url: string }>)[0]!;
    await ownerApi.delete(`/resources/${venue.turfId}/photos/${photo.id}`);
    const rows = (await (await adminApi.get(`/admin/deleted-files?status=all&search=${encodeURIComponent(venue.name)}`)).json()) as Array<{ removedAt: string | null }>;
    test.skip(rows[0]?.removedAt === null, 'the API leaves files in the bucket (STORAGE_DELETE_FILES is off)');

    expect((await request.head(photo.url)).status()).toBe(404); // really gone from the bucket
    await openList(page, venue);
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toHaveCount(0); // not waiting
    await pickStatus(page, 'Removed from the bucket');
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toContainText('Removed');

    // "Clear removed history" asks first, and cancelling deletes nothing. (Deleting is covered by the API tests, so the shared database keeps its history.)
    await page.getByRole('button', { name: 'Clear removed history' }).click();
    await expect(page.getByText(/from the database\?/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText(/from the database\?/)).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: venue.name })).toHaveCount(1);
  });

  test('the summary counts what is waiting and what is removed', async ({ adminApi }) => {
    const summary = await (await adminApi.get('/admin/deleted-files/summary')).json();
    expect(summary).toEqual({ waiting: expect.any(Number), removed: expect.any(Number) });
  });
});
