import { logIn, searchNear, settled, shareLocation } from '../../support/customer-ui';
import { addDays, isoWeekday, istToday, uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';

/** A unit's price is per block of its shortest booking: the booking window steps in whole blocks and prices the sum. */
test.describe('customer site: booking lengths', () => {
  test('stepping the length up prices every block, and the held booking is for that length', async ({ page, context, remoteVenue }) => {
    test.setTimeout(150_000);
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    await logIn(page, uniquePhone(), 'PW Block Booker');
    await settled(page);

    // Two days ahead: the turf costs 800 an hour Monday-Friday and 1000 at the weekend.
    const day = addDays(istToday(), 2);
    const hourly = isoWeekday(day) >= 6 ? 1000 : 800;
    await page.getByRole('button', { name: /\d+ [A-Za-z]{3}$/ }).nth(2).click();
    await settled(page);
    await page.getByRole('button', { name: 'Book Now' }).first().click();

    const window = page.getByText('BOOK YOUR SLOT').locator('xpath=ancestor::div[contains(@class,"max-w-md")][1]');
    await expect(window).toContainText('1 hour');
    await expect(window.getByRole('button', { name: new RegExp('^2:00 PM ₹' + hourly) })).toBeVisible();

    await window.getByRole('button', { name: 'Longer booking' }).click();
    await expect(window).toContainText('2 hours');
    await expect(window.getByRole('button', { name: new RegExp('^2:00 PM ₹' + (hourly * 2).toLocaleString('en-IN')) })).toBeVisible();

    await window.getByRole('button', { name: new RegExp('^2:00 PM ₹' + (hourly * 2).toLocaleString('en-IN')) }).click();
    await window.getByRole('button', { name: /^Book/ }).last().click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByText('2:00 PM – 4:00 PM')).toBeVisible();
    // Checkout shows the two-block total (the full price, whatever is charged online).
    await expect(page.getByText(new RegExp('INR ' + hourly * 2 + '(\\.00)?'))).not.toHaveCount(0);
  });
});
