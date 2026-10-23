import { expect, test } from '../../support/fixtures';

/** The Super Admin can set a venue's Google Maps link too. */
test.describe('admin: venue Google Maps link', () => {
  test('is added, shown as an Open link, and removed', async ({ page, makeVenue, adminApi }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: 'Google Maps link' })).toBeVisible();

    await page.getByRole('button', { name: 'Add a link' }).click();
    await page.getByLabel('Link').fill('https://www.google.com/search?q=venue');
    await page.getByRole('button', { name: 'Save link' }).click();
    await expect(page.getByText(/Use a Google Maps link/)).toBeVisible();

    const good = 'https://www.google.com/maps/place/Turf/@11.0,76.0,17z';
    await page.getByLabel('Link').fill(good);
    await page.getByRole('button', { name: 'Save link' }).click();
    await expect(page.getByRole('link', { name: good })).toBeVisible();
    expect((await (await adminApi.get(`/venues/${venue.id}`)).json()).googleMapsUrl).toBe(good);

    await page.getByRole('button', { name: 'Change link' }).click();
    await page.getByRole('button', { name: 'Remove link' }).click();
    await expect(page.getByText('None. The Directions button uses your map pin instead.')).toBeVisible();
  });

  test('the new-venue form checks the link before sending', async ({ page }) => {
    await page.goto('/venues/new');
    await page.getByLabel('Google Maps link (optional)').fill('javascript:alert(1)');
    await page.getByRole('button', { name: /Create Venue/i }).click();
    await expect(page.getByText(/Use a Google Maps link/)).toBeVisible();
  });
});
