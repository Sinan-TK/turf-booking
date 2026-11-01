import { expect, test } from '../../support/fixtures';

/** The venue's Google Maps link (what customers' Directions button opens), set and removed by its owner. */
test.describe('owner portal: venue Google Maps link', () => {
  test('is added, refused when it is not a Google Maps link, changed and removed', async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: 'Google Maps link' })).toBeVisible();
    await expect(page.getByText('None. The Directions button uses your map pin instead.')).toBeVisible();

    await page.getByRole('button', { name: 'Edit Google Maps link' }).click();
    await page.getByLabel('Link').fill('https://evil.example.com/maps/place/x');
    await page.getByRole('button', { name: 'Save link' }).click();
    await expect(page.getByText('Use a Google Maps link: open the place in Google Maps, choose Share, then Copy link.')).toBeVisible();

    await page.getByLabel('Link').fill('http://www.google.com/maps/place/x');
    await page.getByRole('button', { name: 'Save link' }).click();
    await expect(page.getByText(/Use a Google Maps link/)).toBeVisible(); // not https

    const good = 'https://maps.app.goo.gl/OwnerLink123';
    await page.getByLabel('Link').fill(good);
    await page.getByRole('button', { name: 'Save link' }).click();
    const shown = page.getByRole('link', { name: good });
    await expect(shown).toBeVisible();
    await expect(shown).toHaveAttribute('target', '_blank');
    await expect(shown).toHaveAttribute('rel', /noopener/);
    expect((await (await ownerApi.get(`/venues/${venue.id}`)).json()).googleMapsUrl).toBe(good);

    await page.getByRole('button', { name: 'Edit Google Maps link' }).click();
    await page.getByRole('button', { name: 'Remove link' }).click();
    await expect(page.getByText('None. The Directions button uses your map pin instead.')).toBeVisible();
    expect((await (await ownerApi.get(`/venues/${venue.id}`)).json()).googleMapsUrl).toBeNull();
  });

  test('can be given when a venue is created, and a wrong one is caught before saving', async ({ page }) => {
    await page.goto('/venues/new');
    await page.getByLabel('Google Maps link (optional)').fill('https://example.com/not-maps');
    await page.getByRole('button', { name: /Create Venue/i }).click();
    await expect(page.getByText(/Use a Google Maps link/)).toBeVisible();
    await expect(page).toHaveURL(/\/venues\/new$/);
  });
});
