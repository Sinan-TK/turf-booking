import { addDays, istInstant, istToday, uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';

/** The owner's earnings page and cancelling a booking on the venue's behalf. */
test.describe('owner portal: earnings', () => {
  test('the sidebar reaches Earnings: totals, then by venue, by facility, bookings, payouts and the commission cap', async ({ page, venue }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').getByRole('link', { name: 'Earnings' }).click();
    await expect(page).toHaveURL(/\/earnings$/);
    await expect(page.getByRole('heading', { name: 'Earnings', level: 1 })).toBeVisible();

    // The totals for the chosen period, and what is waiting to be paid.
    for (const label of ['You earned', 'Paid online by customers', 'Kept by the platform', 'Waiting for the next payout']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/Last payout|Nothing paid yet/)).toBeVisible();

    // By venue (the first tab): this run's venue is listed even though nothing has been earned there yet.
    await expect(page.getByRole('tab', { name: 'By venue' })).toHaveAttribute('aria-selected', 'true');
    for (const heading of ['Venue', 'Bookings', 'Paid online', 'Platform kept', 'You earn', 'Share of earnings']) {
      await expect(page.getByRole('columnheader', { name: heading })).toBeVisible();
    }
    const venueSearch = page.getByLabel('Search venues');
    if (await venueSearch.count()) await venueSearch.fill(venue.name);
    await expect(page.getByRole('link', { name: venue.name, exact: true })).toBeVisible();

    // By facility: one row per type of venue, with its icon.
    await page.getByRole('tab', { name: 'By facility' }).click();
    await expect(page).toHaveURL(/tab=facilities/);
    await expect(page.getByText(/^Football/).first()).toBeVisible();
    await expect(page.getByText('Badminton Court', { exact: true }).first()).toBeVisible();

    // Bookings: the listing behind the numbers, with its filters.
    await page.getByRole('tab', { name: 'Bookings' }).click();
    await expect(page.getByLabel('Search earnings by order')).toBeVisible();
    await expect(page.getByText(/^\d+ bookings? in this period\./)).toBeVisible();

    // Payouts.
    await page.getByRole('tab', { name: 'Payouts' }).click();
    await expect(page.getByText(/No payouts yet|Statement/).first()).toBeVisible();

    // The commission cap: counts the calendar month, not the payout week, and each card says when it starts over.
    await page.getByRole('tab', { name: 'Commission cap' }).click();
    await expect(page.getByRole('heading', { name: 'Commission cap this month, by venue and facility' })).toBeVisible();
    await expect(page.getByText(/not the payout week/)).toBeVisible();
    const capSearch = page.getByLabel('Search venues');
    if (await capSearch.count()) await capSearch.fill(venue.name); // the search only appears when there are many cards
    await expect(page.getByText(venue.name, { exact: true })).toHaveCount(2); // a card each for its turf and its court
    await expect(page.getByText(/Next booking: .*(of the booking price|per booking|payment fee)/).first()).toBeVisible();
  });

  test('the period changes the totals, and a venue or facility opens its bookings', async ({ page, venue }) => {
    await page.goto('/earnings');
    const period = page.locator('label').filter({ hasText: /^Show/ }).locator('select');
    await expect(period).toHaveValue('month');
    await period.selectOption({ label: 'All time' });
    await expect(period).toHaveValue('all');
    await period.selectOption({ label: 'Last month' });
    await expect(page.getByText(/booking(s)? last month/)).toBeVisible();

    // "Bookings" on a venue's row opens the bookings listing already filtered to it.
    const venueSearch = page.getByLabel('Search venues');
    if (await venueSearch.count()) await venueSearch.fill(venue.name);
    await page.getByRole('row').filter({ hasText: venue.name }).getByRole('button', { name: /Bookings/ }).click();
    await expect(page).toHaveURL(/tab=bookings/);
    await expect(page.getByRole('tab', { name: 'Bookings' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('label').filter({ hasText: /^Venue/ }).locator('select')).not.toHaveValue('');
    await expect(page.getByText(/match your filters/)).toBeVisible();
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
