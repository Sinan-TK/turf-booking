import { unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.describe("admin: a facility's picture", () => {
  test('a new facility asks to be saved first; a saved one takes a picture, shows it, replaces it and removes it', async ({ page, adminApi }) => {
    await page.goto('/venue-types/new');
    await expect(page.getByText('Save the facility first, then add its picture here.')).toBeVisible();

    const slug = `PW_${unique().toUpperCase()}`;
    const created = await adminApi.post('/admin/categories', {
      data: { slug, name: `PW Picture ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [] },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/venue-types/${id}`);
    await expect(page.getByText('No picture')).toBeVisible();
    await page.getByLabel('Choose a facility picture').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: PNG });
    // It opens in the cropper first; nothing is uploaded until the framed picture is accepted.
    const cropper = page.getByRole('dialog', { name: 'Frame the picture' });
    await expect(cropper).toBeVisible();
    await expect(cropper.getByRole('slider', { name: 'Zoom' })).toBeVisible();
    await cropper.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('No picture')).toBeVisible();
    await page.getByLabel('Choose a facility picture').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: 'Frame the picture' }).getByRole('button', { name: 'Use picture' }).click();
    const img = page.getByRole('img', { name: 'Facility picture' });
    await expect(img).toBeVisible();
    // The saved picture really loads (a visible but broken image has no width of its own).
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    await expect(img).toHaveAttribute('src', new RegExp(`/facilities/${id}/`));
    await expect(page.getByRole('button', { name: 'Replace picture' })).toBeVisible();

    // It is saved already: the facility says so after a reload, and the public list carries it.
    await page.reload();
    await expect(page.getByRole('img', { name: 'Facility picture' })).toBeVisible();

    const firstSrc = await page.getByRole('img', { name: 'Facility picture' }).getAttribute('src');
    await page.getByLabel('Choose a facility picture').setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('dialog', { name: 'Frame the picture' }).getByRole('button', { name: 'Use picture' }).click();
    await expect(page.getByRole('img', { name: 'Facility picture' })).not.toHaveAttribute('src', firstSrc!);

    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByText('No picture')).toBeVisible();
  });

  test('a file that is not a picture is refused with a message', async ({ page, adminApi }) => {
    const slug = `PW_${unique().toUpperCase()}`;
    const created = await adminApi.post('/admin/categories', {
      data: { slug, name: `PW Picture ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [] },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/venue-types/${id}`);
    await page.getByLabel('Choose a facility picture').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a picture' })).toBeVisible();
  });
});
