import { expect, test } from '../../support/fixtures';
import { png } from '../../support/png';
import { openSection, openUnitTab } from '../../support/ui';

/** A photo one unit already has can be used on another unit without uploading it again, and stays while any unit still uses it. */
test.describe('owner portal: reusing a photo on another unit', () => {
  test('pick a photo from another unit; removing it from one unit keeps it on the other', async ({ page, ownerApi, makeVenue }) => {
    const venue = await makeVenue();
    const added = await ownerApi.post(`/resources/${venue.turfId}/photos`, {
      multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: png(800, 400, [40, 120, 200]) } },
    });
    expect(added.ok(), await added.text()).toBeTruthy();

    await page.goto(`/venues/${venue.id}`);
    await openSection(page, 'Units');
    await openUnitTab(page, venue.courtName);
    await expect(page.locator(`img[alt^="${venue.courtName} photo"]`)).toHaveCount(0);

    // The other unit's photo is offered, named by where it is used; picking it adds it here.
    await page.getByRole('button', { name: /Use a photo you already have/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Use a photo you already have' });
    const offered = dialog.getByRole('button', { name: `Photo from ${venue.name} · ${venue.turfName}` });
    await expect(offered).toBeVisible();
    await offered.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(`img[alt="${venue.courtName} photo 1"]`)).toBeVisible({ timeout: 15_000 });

    // Both units show it; it is one stored file.
    await openUnitTab(page, venue.turfName);
    await expect(page.locator(`img[alt="${venue.turfName} photo 1"]`)).toBeVisible();
    const turfSrc = await page.locator(`img[alt="${venue.turfName} photo 1"]`).getAttribute('src');
    await openUnitTab(page, venue.courtName);
    expect(await page.locator(`img[alt="${venue.courtName} photo 1"]`).getAttribute('src')).toBe(turfSrc);
    // A unit that has it is not offered it again.
    await expect(page.getByRole('button', { name: /Use a photo you already have/ })).toBeVisible();
    await page.getByRole('button', { name: /Use a photo you already have/ }).click();
    await expect(page.getByRole('dialog', { name: 'Use a photo you already have' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: `Photo from ${venue.name} · ${venue.turfName}` })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Removing it from the court (a hold) leaves the turf's copy in place and still loading.
    const remove = page.getByRole('button', { name: new RegExp(`^Remove photo 1 of ${venue.courtName}`) });
    await remove.hover();
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await expect(page.locator(`img[alt^="${venue.courtName} photo"]`)).toHaveCount(0);
    await openUnitTab(page, venue.turfName);
    const img = page.locator(`img[alt="${venue.turfName} photo 1"]`);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  });
});
