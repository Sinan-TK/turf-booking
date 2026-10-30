import { addDays, istInstant, istToday, uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';

/** The customer did not come: the owner marks it on the booking, and can take it back. */
test.describe('owner portal: no-show', () => {
  /** The start of the hour, `hoursAgo` hours before now, on the Kolkata hour grid the bookings use. */
  const hourAgo = (hoursAgo: number) => {
    const offset = 5.5 * 3_600_000;
    return new Date(Math.floor((Date.now() - hoursAgo * 3_600_000 + offset) / 3_600_000) * 3_600_000 - offset).toISOString();
  };

  test('a booking whose slot has started is marked a no-show, with the money explained, and can be taken back', async ({ page, venue, ownerApi }) => {
    const made = await ownerApi.post('/owner/bookings', {
      data: { resourceId: venue.courtId, durationMinutes: 60, customerWhatsappNumber: uniquePhone(), customerName: 'PW Absent', amount: 300, startTime: hourAgo(3) },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const { id } = (await made.json()) as { id: string };

    await page.goto(`/bookings/${id}`);
    await expect(page.getByRole('button', { name: 'Mark as played' })).toHaveCount(0); // it is not a no-show yet
    await page.getByRole('button', { name: 'Mark as no-show' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Mark as a no-show?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Nothing was paid online'); // a walk-in: nothing to keep or refund
    await expect(dialog).toContainText('up to 7 days');
    await dialog.getByRole('button', { name: 'Yes, they did not come' }).click();

    await expect(page.getByText('Marked as a no-show.')).toBeVisible();
    await expect(page.getByText('NO SHOW', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as no-show' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark as played' })).toBeVisible();

    // The bookings list can be filtered to no-shows and finds it.
    await page.goto('/bookings');
    await page.getByLabel('Status').selectOption({ label: 'No show' });
    await expect(page.getByRole('row').filter({ hasText: 'PW Absent' })).toBeVisible();

    // Taken back.
    await page.goto(`/bookings/${id}`);
    await page.getByRole('button', { name: 'Mark as played' }).click();
    await page.getByRole('alertdialog', { name: 'Mark as played?' }).getByRole('button', { name: 'Yes, they came' }).click();
    await expect(page.getByText('Marked as played again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as no-show' })).toBeVisible();
  });

  test('there is no no-show button before the slot starts', async ({ page, venue, ownerApi }) => {
    const day = addDays(istToday(), 3);
    const made = await ownerApi.post('/owner/bookings', {
      data: { resourceId: venue.courtId, durationMinutes: 60, customerWhatsappNumber: uniquePhone(), customerName: 'PW Later', startTime: istInstant(day, 15), amount: 300 },
    });
    expect(made.ok(), await made.text()).toBeTruthy();
    const { id } = (await made.json()) as { id: string };
    await page.goto(`/bookings/${id}`);
    await expect(page.getByRole('button', { name: 'Cancel this booking' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as no-show' })).toHaveCount(0);
  });
});
