import { addDays, istInstant, istToday, uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';
import { unique } from '../../support/env';

/** The admin's bookings: newest booking first, and a click on a column header sorts by it (again to flip it). */
test.describe('admin: booking list sorting', () => {
  test('newest first by default, and every sortable header sorts both ways', async ({ page, ownerApi, venue }) => {
    const tag = `Srt${unique()}`;
    for (const [name, days] of [['C', 6], ['A', 3], ['B', 5]] as const) {
      const res = await ownerApi.post('/owner/bookings', {
        data: { resourceId: venue.turfId, durationMinutes: 60, customerWhatsappNumber: uniquePhone(), customerName: `${tag} ${name}`, amount: 500, startTime: istInstant(addDays(istToday(), days), 11) },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    await page.goto('/bookings');
    await page.getByLabel('Search bookings').fill(tag);
    const rows = page.getByRole('row').filter({ hasText: tag });
    await expect(rows).toHaveCount(3);
    const order = async () => (await rows.allTextContents()).map((t) => ['A', 'B', 'C'].find((n) => t.includes(`${tag} ${n}`))!);
    const header = (name: string) => page.getByRole('columnheader', { name: new RegExp(`^${name}`) });

    expect(await order()).toEqual(['B', 'A', 'C']);
    await expect(header('Booked')).toHaveAttribute('aria-sort', 'descending');

    await header('Customer').getByRole('button').click();
    await expect(header('Customer')).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(order).toEqual(['A', 'B', 'C']);
    await header('Customer').getByRole('button').click();
    await expect.poll(order).toEqual(['C', 'B', 'A']);

    await header('Start').getByRole('button').click();
    await expect.poll(order).toEqual(['C', 'B', 'A']);
    await header('Start').getByRole('button').click();
    await expect.poll(order).toEqual(['A', 'B', 'C']);

    await header('Order').getByRole('button').click();
    await expect.poll(order).toEqual(['B', 'A', 'C']);
    await header('Order').getByRole('button').click();
    await expect.poll(order).toEqual(['C', 'A', 'B']);
  });
});
