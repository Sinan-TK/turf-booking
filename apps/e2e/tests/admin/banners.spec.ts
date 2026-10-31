import { URLS, unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** The Super Admin's Banners: add one with a picture, see it go live on the public list, switch it off, and delete it. */
test.describe('admin: banners', () => {
  test('a banner is added with a framed picture, shown to customers, switched off and deleted', async ({ page, request }) => {
    const title = `PW Banner ${unique()}`;
    const live = async () => ((await (await request.get(`${URLS.api}/banners`)).json()) as Array<{ title: string; imageUrl: string | null; linkUrl: string | null }>).find((b) => b.title === title);

    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Banners' }).click();
    await expect(page.getByRole('heading', { name: 'Banners', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New banner' }).click();
    const dialog = page.getByRole('dialog', { name: 'New banner' });

    // Needs a title, and a link must be a path or an https address.
    await dialog.getByRole('button', { name: 'Add banner' }).click();
    await expect(dialog.getByText('Enter the title.')).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel(/Where a tap goes/).fill('javascript:alert(1)');
    await dialog.getByRole('button', { name: 'Add banner' }).click();
    await expect(dialog.getByText(/Use a path on this site/)).toBeVisible();
    await dialog.getByLabel(/Where a tap goes/).fill('/explore?type=FOOTBALL_TURF');

    // The picture is framed in the cropper first.
    await dialog.getByLabel('Choose a banner picture').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
    const cropper = page.getByRole('dialog', { name: 'Frame the banner' });
    await expect(cropper).toBeVisible();
    await cropper.getByRole('button', { name: 'Use picture' }).click();
    await expect(dialog.getByRole('img', { name: 'Banner picture' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Add banner' }).click();
    await expect(page.getByRole('dialog', { name: 'New banner' })).toHaveCount(0);

    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText('ACTIVE');
    await expect(row).toContainText('Goes to /explore?type=FOOTBALL_TURF');
    await expect.poll(async () => (await live())?.imageUrl ?? '').toMatch(/\/banners\/[0-9a-f-]{36}\/[0-9a-f-]{36}\./);
    expect((await live())?.linkUrl).toBe('/explore?type=FOOTBALL_TURF');

    await row.getByRole('button', { name: /Switch off banner/ }).click();
    await expect(row).toContainText('INACTIVE');
    await expect.poll(async () => (await live()) === undefined).toBe(true);
    await row.getByRole('button', { name: /Switch on banner/ }).click();
    await expect.poll(async () => (await live()) !== undefined).toBe(true);

    await row.getByRole('button', { name: /Delete banner/ }).click();
    await page.getByRole('dialog', { name: 'Delete this banner?' }).getByRole('button', { name: 'Delete banner' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
    await expect.poll(async () => (await live()) === undefined).toBe(true);
  });
});
