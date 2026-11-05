import { expect, test } from '../../support/fixtures';
import { png } from '../../support/png';
import { openSection, openUnitTab } from '../../support/ui';

/** Photos added to a unit stay when the owner moves to another unit and comes back (no reload needed). */
test.describe('owner portal: unit photos', () => {
  test('a photo added to a unit is still there after switching to another unit and back', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await openSection(page, 'Units');
    await openUnitTab(page, venue.turfName);

    await page.locator('input[type=file]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png(800, 400, [200, 40, 40]) });
    await page.getByRole('button', { name: 'Use photo' }).click();
    await expect(page.locator(`img[alt="${venue.turfName} photo 1"]`)).toBeVisible({ timeout: 15_000 });

    await openUnitTab(page, venue.courtName);
    await expect(page.locator(`img[alt^="${venue.turfName} photo"]`)).toHaveCount(0); // the other unit has none of them
    await openUnitTab(page, venue.turfName);
    await expect(page.locator(`img[alt="${venue.turfName} photo 1"]`)).toBeVisible();

    // Leaving the Units section for the Venue section and coming straight back shows it too.
    await openSection(page, 'Venue');
    await openSection(page, 'Units');
    await openUnitTab(page, venue.turfName);
    await expect(page.locator(`img[alt="${venue.turfName} photo 1"]`)).toBeVisible();

    // And removing one is remembered the same way.
    // Deleting needs a hold: a quick tap only explains, and deletes nothing.
    const remove = page.getByRole('button', { name: new RegExp(`^Remove photo 1 of ${venue.turfName}`) });
    await remove.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Press and hold Remove' })).toBeVisible();
    await expect(page.locator(`img[alt="${venue.turfName} photo 1"]`)).toBeVisible();
    await remove.hover();
    await page.mouse.down();
    await page.waitForTimeout(1400);
    await page.mouse.up();
    await expect(page.locator(`img[alt^="${venue.turfName} photo"]`)).toHaveCount(0);
    await openUnitTab(page, venue.courtName);
    await openUnitTab(page, venue.turfName);
    await expect(page.locator(`img[alt^="${venue.turfName} photo"]`)).toHaveCount(0);
  });
});
