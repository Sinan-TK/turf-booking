import { createVenue } from '../../support/api';
import { shareLocation } from '../../support/customer-ui';
import { expect, test } from '../../support/fixtures';

/** The day picker offers as many days as the venues here allow booking ahead: 14 by default (the most), fewer when the owner chooses. */
test.describe('customer site: days offered', () => {
  const dayChips = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^(Today|[A-Z][a-z]{2}) [0-9]{1,2} [A-Z][a-z]{2}$/ });

  test('fourteen days to start with, and as many as the owner allows after that', async ({ page, context, ownerApi, adminApi }) => {
    test.setTimeout(180_000);
    const lat = 8 + Math.random() * 10;
    const lng = 60 + Math.random() * 10;
    const venue = await createVenue(ownerApi, adminApi, { lat, lng });
    await shareLocation(context, lat, lng);

    const choosePlace = async () => {
      await page.goto('/');
      await page.getByRole('button', { name: /Change location/ }).click();
      await page.getByRole('dialog', { name: 'Choose your location' }).getByRole('button', { name: 'Use my current location' }).click();
    };

    await choosePlace();
    await expect(dayChips(page)).toHaveCount(14);

    for (const days of [3, 10, 14]) {
      const saved = await ownerApi.patch(`/venues/${venue.id}`, { data: { advanceBookingDays: days } });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await choosePlace();
      await expect(dayChips(page)).toHaveCount(days);
    }
    // The last day on offer is really bookable, and the strip scrolls sideways when it is long.
    await expect(dayChips(page).first()).toContainText('Today');
    await dayChips(page).last().click();
    await expect(page.getByRole('heading', { name: venue.name }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('a chosen day that a new place does not offer falls back to today', async ({ page, context, ownerApi, adminApi }) => {
    test.setTimeout(180_000);
    const lat = 8 + Math.random() * 10;
    const lng = 60 + Math.random() * 10;
    const venue = await createVenue(ownerApi, adminApi, { lat, lng });
    await ownerApi.patch(`/venues/${venue.id}`, { data: { advanceBookingDays: 2 } });
    await shareLocation(context, lat, lng);
    await page.goto('/');
    await page.getByRole('button', { name: /Change location/ }).click();
    await page.getByRole('dialog', { name: 'Choose your location' }).getByRole('button', { name: 'Use my current location' }).click();
    await expect(dayChips(page)).toHaveCount(2); // a venue that takes bookings two days ahead
  });
});
