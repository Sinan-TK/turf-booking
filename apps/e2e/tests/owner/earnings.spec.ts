import { addDays, istInstant, istToday, uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';

/** The owner's earnings page and cancelling a booking on the venue's behalf. */
test.describe('owner portal: earnings', () => {
  test('the sidebar reaches Earnings, which shows payouts and this month by facility', async ({ page, venue }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Earnings' }).click();
    await expect(page).toHaveURL(/\/earnings$/);
    await expect(page.getByRole('heading', { name: 'Earnings', level: 1 })).toBeVisible();
    await expect(page.getByText('Waiting for the next payout')).toBeVisible();
    await expect(page.getByText('Last payout')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This month, by facility' })).toBeVisible();
    // The cap counts the calendar month, not the payout week, and each card says when it starts over.
    await expect(page.getByText(/not the payout week/)).toBeVisible();
    // The facility cards are paged (a dozen at a time) and searchable: look for this venue's two.
    await page.getByLabel('Search venues').fill(venue.name);
    // The venue's facility is listed with the rate its next booking pays.
    await expect(page.getByText(venue.name, { exact: true })).toHaveCount(2); // a card each for its turf and its court
    await expect(page.getByText('Football Turf', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Badminton Court', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Next booking: .*(of the booking price|per booking|payment fee)/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
  });

  test('the price form shows the facility\'s minimum advance and refuses less', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('button', { name: 'Add price' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Normal price/).fill('1000');
    await expect(dialog.getByText(/at least \d+(\.\d+)?% of the full price, INR [\d,]+/)).toBeVisible();
    await dialog.getByLabel('Booking amount').fill('1');
    await dialog.getByRole('button', { name: 'Add price' }).click();
    await expect(dialog.getByText(/The booking amount must be at least \d+(\.\d+)?% of the normal price/)).toBeVisible();
  });

  test('a venue cancels a booking: the status changes and the booking can\'t be cancelled twice', async ({ page, venue, ownerApi }) => {
    const day = addDays(istToday(), 3);
    const walkIn = await ownerApi.post('/owner/bookings', {
      data: { resourceId: venue.courtId, durationMinutes: 60, customerWhatsappNumber: uniquePhone(), customerName: 'PW Cancel', startTime: istInstant(day, 11), amount: 300 },
    });
    expect(walkIn.ok(), await walkIn.text()).toBeTruthy();
    const { id } = (await walkIn.json()) as { id: string };

    await page.goto(`/bookings/${id}`);
    await page.getByRole('button', { name: 'Cancel this booking' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel this booking?' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Reason/).fill('Heavy rain');
    await dialog.getByRole('button', { name: 'Yes, cancel it' }).click();

    await expect(page.getByText(/^Booking cancelled\./)).toBeVisible();
    await expect(page.getByText('CANCELLED').first()).toBeVisible();
    await expect(page.getByText(/OWNER_ACTION — Heavy rain/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);
    const again = await ownerApi.post(`/owner/bookings/${id}/cancel`, { data: {} });
    expect(again.status()).toBe(400);
  });
});
