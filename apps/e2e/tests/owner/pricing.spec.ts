import { expect, test } from '../../support/fixtures';
import { field, rowWith } from '../../support/ui';

/**
 * Prices decide both what a slot costs and when a unit can be booked, and two active prices for
 * the same unit and duration may not cover the same day and time.
 */
test.describe('owner portal: pricing', () => {
  test('lists the prices with their days, hours and amount', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);
    await expect(page.getByRole('tab', { name: 'Pricing & hours' })).toHaveAttribute('aria-selected', 'true');
    // There is no separate Opening hours tab any more.
    await expect(page.getByRole('tab', { name: /Opening hours/ })).toHaveCount(0);

    await expect(rowWith(page, 'Mon–Fri')).toContainText('6:00 am – 10:00 pm');
    await expect(rowWith(page, 'Mon–Fri')).toContainText('INR 800');
    await expect(rowWith(page, 'Mon–Fri')).toContainText('Active');
    await expect(rowWith(page, 'Sat, Sun')).toContainText('INR 1,000');

    // The other unit has its own prices.
    await page.getByRole('combobox').first().selectOption({ index: 1 });
    await expect(rowWith(page, 'Every day')).toContainText('All day');
    await expect(rowWith(page, 'Every day')).toContainText('INR 300');
  });

  test('refuses a price that overlaps an active one, naming the clash', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('button', { name: 'Add price' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add a price' })).toBeVisible();

    // Every day, all day, 900: clashes with Mon-Fri 6am-10pm.
    await field(dialog, 'Normal price').fill('900');
    await dialog.getByRole('button', { name: 'Add price' }).click();
    await expect(dialog).toContainText('This overlaps an existing price');
    // It names one of the two active prices it collides with (Mon-Fri or Sat-Sun, both 6am-10pm).
    await expect(dialog).toContainText(/((Mon–Fri|Sat, Sun), 6:00 am – 10:00 pm, 60 min at INR (800|1000))/);
    await expect(dialog.getByRole('heading', { name: 'Add a price' })).toBeVisible(); // still open to fix it

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(rowWith(page, 'INR 900')).toHaveCount(0);
  });

  test('add, edit, block, unblock-conflict and remove a price, each with its own dialog', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);

    // --- Add: Mon-Fri 10pm-11pm (a gap in the existing prices) ---
    await page.getByRole('button', { name: 'Add price' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Weekdays' }).click();
    await modal.getByRole('radio', { name: 'Specific hours' }).click();
    await modal.getByLabel('From', { exact: true }).fill('22:00');
    await modal.getByLabel('To', { exact: true }).fill('23:00');
    await field(modal, 'Normal price').fill('1200');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal).toHaveCount(0);
    const evening = rowWith(page, '10:00 pm – 11:00 pm');
    await expect(evening).toContainText('INR 1,200');

    // --- Edit: the modal is pre-filled; change the amount ---
    await evening.getByRole('button', { name: 'Edit price' }).click();
    await expect(modal.getByRole('heading', { name: 'Edit price' })).toBeVisible();
    await expect(field(modal, 'Normal price')).toHaveValue('1200');
    await expect(modal.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'false');
    await field(modal, 'Normal price').fill('1300');
    await modal.getByRole('button', { name: 'Save changes' }).click();
    await expect(modal).toHaveCount(0);
    await expect(evening).toContainText('INR 1,300');

    // --- Block: asks first, then the row is struck out and marked Blocked ---
    const dialog = page.getByRole('alertdialog');
    await evening.getByRole('button', { name: 'Block price' }).click();
    await expect(dialog.getByRole('heading', { name: 'Block this price?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(evening).toContainText('Active');
    await evening.getByRole('button', { name: 'Block price' }).click();
    await dialog.getByRole('button', { name: 'Block price' }).click();
    await expect(evening).toContainText('Blocked');

    // --- While it is blocked, the same slot can be priced again; then the blocked one cannot come back ---
    await page.getByRole('button', { name: 'Add price' }).click();
    await modal.getByRole('button', { name: 'Weekdays' }).click();
    await modal.getByRole('radio', { name: 'Specific hours' }).click();
    await modal.getByLabel('From', { exact: true }).fill('22:00');
    await modal.getByLabel('To', { exact: true }).fill('23:00');
    await field(modal, 'Normal price').fill('1500');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal).toHaveCount(0);

    await evening.filter({ hasText: 'Blocked' }).getByRole('button', { name: 'Unblock price' }).click();
    await expect(dialog.getByRole('heading', { name: 'Turn this price back on?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Unblock price' }).click();
    await expect(dialog).toContainText('This overlaps an existing price'); // refused, dialog stays open with the reason
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // --- Remove the new one (asks first), after which the blocked one can be unblocked ---
    const replacement = rowWith(page, 'INR 1,500');
    await replacement.getByRole('button', { name: 'Remove price' }).click();
    await expect(dialog.getByRole('heading', { name: 'Remove this price?' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove price' }).click();
    await expect(replacement).toHaveCount(0);

    await rowWith(page, 'INR 1,300').getByRole('button', { name: 'Unblock price' }).click();
    await dialog.getByRole('button', { name: 'Unblock price' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rowWith(page, 'INR 1,300')).toContainText('Active');
  });

  test('a price with a time window must end after it starts', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('button', { name: 'Add price' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Weekdays' }).click();
    await modal.getByRole('radio', { name: 'Specific hours' }).click();
    await modal.getByLabel('From', { exact: true }).fill('20:00');
    await modal.getByLabel('To', { exact: true }).fill('19:00');
    await field(modal, 'Normal price').fill('500');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal).toContainText('The end time must be after the start time');
  });

  test('a price has a normal price, an optional offer and a booking amount, with the rules between them', async ({
    page,
    makeVenue,
  }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('button', { name: 'Add price' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Weekdays' }).click();
    await modal.getByRole('radio', { name: 'Specific hours' }).click();
    await modal.getByLabel('From', { exact: true }).fill('22:00');
    await modal.getByLabel('To', { exact: true }).fill('23:00');

    // The booking amount follows the full price until you set your own.
    await field(modal, 'Normal price').fill('1000');
    await expect(field(modal, 'Booking amount')).toHaveValue('1000');
    await expect(modal).toContainText('nothing more to pay at the venue');

    // An offer must be below the normal price; the booking amount can't exceed the full price.
    await field(modal, 'Offer price').fill('1000');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal.getByText('The offer price must be below the normal price.')).toBeVisible();
    await field(modal, 'Offer price').fill('800');
    await expect(modal.getByText('The offer price must be below the normal price.')).toHaveCount(0);
    await field(modal, 'Booking amount').fill('900');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal.getByText(/The booking amount can.t be more than the offer price \(800\)\./)).toBeVisible();
    await field(modal, 'Booking amount').fill('300');
    await expect(modal).toContainText('INR 300 online to hold the slot and INR 500 at the venue');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal).toHaveCount(0);

    // The list shows the offer as the price, the normal price struck through, and what is paid online.
    const row = rowWith(page, '10:00 pm – 11:00 pm');
    await expect(row).toContainText('INR 1,000');
    await expect(row).toContainText('INR 800');
    await expect(row).toContainText('Offer');
    await expect(row).toContainText('INR 300');
    await expect(row).toContainText('INR 500 at the venue');
  });

  test('the price, closed-day and walk-in forms flag each field that is missing', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);

    await page.getByRole('button', { name: 'Add price' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal.getByText('Enter the normal price.')).toBeVisible();
    await field(modal, 'Normal price').fill('500');
    await expect(modal.getByText('Enter the normal price.')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Monday' }).click(); // un-pick every day, one by one
    for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await modal.getByRole('button', { name: day }).click();
    }
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal.getByText('Choose at least one day.')).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('tab', { name: 'Closed days' }).click();
    await page.getByRole('button', { name: 'Close This Day' }).click();
    await expect(page.getByText('Choose the day to close.')).toBeVisible();
    await page.getByRole('button', { name: 'Range of days' }).click();
    await page.getByRole('button', { name: 'Close These Days' }).click();
    await expect(page.getByText('Choose the first day.')).toBeVisible();
    await expect(page.getByText('Choose the last day.')).toBeVisible();

    await page.getByRole('tab', { name: 'Walk-in booking' }).click();
    await page.getByRole('button', { name: 'Book This Slot' }).click();
    await expect(page.getByText('Choose the date.')).toBeVisible();
    await expect(page.getByText('Choose the start time.')).toBeVisible();
    await expect(page.getByText('Enter the customer’s WhatsApp number.')).toBeVisible();
    await field(page, 'Customer WhatsApp Number').fill('abc');
    await page.getByRole('button', { name: 'Book This Slot' }).click();
    await expect(page.getByText('Use digits only, with an optional + at the start.')).toBeVisible();
  });

  test('the Closed days and Walk-in booking tabs open', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('tab', { name: 'Closed days' }).click();
    await expect(page.getByRole('tab', { name: 'Closed days' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Closed Days' })).toBeVisible();
    await page.getByRole('tab', { name: 'Walk-in booking' }).click();
    await expect(page.getByRole('heading', { name: /Book a Slot/ })).toBeVisible();
  });
});
