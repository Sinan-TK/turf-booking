import { expect, test } from '../../support/fixtures';

test.describe('owner portal: My Venues list', () => {
  test('lists the venue and filters it by search, status and facility', async ({ page, venue }) => {
    await page.goto('/venues');
    const row = page.getByRole('row').filter({ hasText: venue.name });

    // Search by name, then by something that matches nothing.
    await page.getByLabel('Search venues').fill(venue.name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Football Turf');
    await expect(row).toContainText('Badminton Court');
    await expect(row).toContainText('ACTIVE');

    await page.getByLabel('Search venues').fill('zzz-no-such-venue-zzz');
    await expect(page.getByText('No venues match your search or filters.')).toBeVisible();
    await expect(page.getByText(/0 venues match/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByLabel('Search venues')).toHaveValue('');

    // Status filter: this venue is Active, so Draft hides it and Active shows it.
    await page.getByLabel('Search venues').fill(venue.name);
    await page.getByLabel('Status').selectOption('DRAFT');
    await expect(row).toHaveCount(0);
    await page.getByLabel('Status').selectOption('ACTIVE');
    await expect(row).toHaveCount(1);

    // Facility filter.
    await page.getByLabel('Facility').selectOption({ label: 'Football Turf' });
    await expect(row).toHaveCount(1);
  });

  test('Manage opens the venue and New venue opens the form', async ({ page, venue }) => {
    await page.goto('/venues');
    await page.getByLabel('Search venues').fill(venue.name);
    const row = page.getByRole('row').filter({ hasText: venue.name });
    await expect(row).toHaveCount(1); // wait for the list to settle before clicking in it
    await row.getByRole('link', { name: /Manage/ }).click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}$`));
    await expect(page.getByRole('heading', { name: venue.name })).toBeVisible();

    await page.goto('/venues');
    await page.getByRole('link', { name: /New venue/ }).click();
    await expect(page).toHaveURL(/\/venues\/new$/);
  });
});
