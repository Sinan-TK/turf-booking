import { nextIstDay, istInstant, uniquePhone } from '../../support/dates';
import { apiAs } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { field, openUnitTab } from '../../support/ui';

/**
 * Each unit has its own shortest and longest booking, and its prices are per block of the shortest: a longer booking
 * costs one price per block.
 */
test.describe('owner portal: booking lengths per unit', () => {
  test('the owner changes a unit\'s lengths; a longest that is not a multiple of the shortest is refused', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    const row = page.getByRole('region', { name: venue.turfName });
    await expect(row).toContainText('Booked for 1 hour up to 3 hours');

    await row.getByRole('button', { name: 'Change length' }).click();
    await field(row, 'Longest booking').selectOption({ label: '4 hours' });
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('Booked for 1 hour up to 4 hours');

    // The shortest booking is on the venue type's one-hour grid: 90 minutes is refused by the server's rules.
    await row.getByRole('button', { name: 'Change length' }).click();
    await field(row, 'Shortest booking (minutes)').fill('90');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('multiple of 60 minutes');
  });

  test('the price page says what a price is for, and a new unit can start with its own lengths', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('button', { name: 'Add price' }).click();
    await expect(page.getByRole('dialog')).toContainText('These prices are for 1 hour');
    await expect(page.getByRole('dialog').getByLabel('Duration')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, 'New');
    await page.locator('#unit-categoryId').selectOption({ label: 'Football' });
    await expect(field(page, 'Shortest booking (minutes)').last()).toHaveValue('60');
    await field(page, 'Shortest booking (minutes)').last().fill('120');
    await expect(field(page, 'Longest booking').last()).toHaveValue('120'); // 180 does not fit 120-minute blocks: it moves to 120
  });

  test('a 2-hour walk-in costs two block prices, and a length past the unit\'s longest is refused', async ({ venue }) => {
    const owner = await apiAs('owner');
    const monday = nextIstDay(1);
    const ok = await owner.post('/owner/bookings', {
      data: { resourceId: venue.turfId, durationMinutes: 120, customerWhatsappNumber: uniquePhone(), startTime: istInstant(monday, 10) },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    expect(Number((await ok.json()).amount)).toBe(1600); // two 800 blocks (Mon-Fri price)

    const tooLong = await owner.post('/owner/bookings', {
      data: { resourceId: venue.turfId, durationMinutes: 300, customerWhatsappNumber: uniquePhone(), startTime: istInstant(monday, 12) },
    });
    expect(tooLong.status()).toBe(400);
  });
});
