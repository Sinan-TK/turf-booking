import type { APIRequestContext } from '@playwright/test';
import { istInstant, nextIstDay, uniquePhone } from '../../support/dates';
import type { PwVenue } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { unique } from '../../support/env';
import { field, rowWith } from '../../support/ui';

/** A walk-in booking made through the API (the same call the form makes). */
async function walkIn(owner: APIRequestContext, resourceId: string, ymd: string, hour: number, phone: string, name = 'PW Customer') {
  const res = await owner.post('/owner/bookings', {
    data: { resourceId, durationMinutes: 60, customerWhatsappNumber: phone, customerName: name, startTime: istInstant(ymd, hour) },
  });
  expect(res.ok(), `walk-in failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; orderId: string };
}

test.describe('owner portal: bookings', () => {
  test('a walk-in booking made on the form is confirmed, listed, and opens its detail page', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}/availability`);
    await page.getByRole('tab', { name: 'Walk-in booking' }).click();
    const form = page.locator('form').filter({ hasText: 'Book This Slot' });

    const phone = uniquePhone();
    await field(form, 'Resource').selectOption({ index: 0 }); // Turf A
    await field(form, 'Date').fill(nextIstDay(3)); // a Wednesday, inside the 6am-10pm weekday price
    await field(form, 'Start Time').fill('11:00');
    await form.locator('#walkin-phone').fill(phone); // the +91 sits outside the box; a pasted +91 number is trimmed to the ten digits
    await field(form, 'Customer Name (optional)').fill('PW Walk-in Guest');
    await form.getByRole('button', { name: 'Book This Slot' }).click();

    const banner = page.getByText(/Booked as BK/);
    await expect(banner).toBeVisible();
    await page.getByRole('link', { name: 'View booking →' }).click();

    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: /^Booking BK/ })).toBeVisible();
    await expect(page.getByText('CONFIRMED').first()).toBeVisible();
    await expect(page.getByText('PW Walk-in Guest')).toBeVisible();
    await expect(page.getByText('Walk-in', { exact: true })).toBeVisible(); // marked as a walk-in, not a customer account
    await expect(page.getByText('(number not verified)')).toHaveCount(0);
    await expect(page.getByText(venue.name)).toBeVisible();
    await expect(page.getByText('INR 800').first()).toBeVisible(); // priced by the Mon-Fri price
    await page.getByRole('link', { name: 'All bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
  });

  test('the list searches, filters and clears', async ({ page, venue, ownerApi }) => {
    const day = nextIstDay(4);
    const phoneA = uniquePhone();
    const phoneB = uniquePhone();
    // Names are unique per run so earlier runs' bookings never match.
    const alice = `PW Alice ${unique()}`;
    const bob = `PW Bob ${unique()}`;
    await walkIn(ownerApi, venue.turfId, day, 9, phoneA, alice);
    await walkIn(ownerApi, venue.turfId, day, 10, phoneB, bob);

    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'Bookings', level: 1 })).toBeVisible();

    // Search by customer phone, then by name.
    await page.getByLabel('Search bookings').fill(phoneA);
    await expect(rowWith(page, alice)).toHaveCount(1);
    await expect(rowWith(page, bob)).toHaveCount(0);
    await page.getByLabel('Search bookings').fill(bob);
    await expect(rowWith(page, bob)).toHaveCount(1);

    // A filter that matches nothing says so and offers to clear.
    await page.getByLabel('Status').selectOption('CANCELLED');
    await expect(page.getByText('No bookings match your search or filters.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByLabel('Search bookings')).toHaveValue('');
    await expect(page.getByLabel('Status')).toHaveValue('');

    // Venue filter and paid-by filter.
    await page.getByLabel('Venue').selectOption({ label: venue.name });
    await expect(rowWith(page, alice)).toHaveCount(1);
    await expect(rowWith(page, bob)).toHaveCount(1);
    await page.getByLabel('Paid by').selectOption('MONEY'); // walk-ins are not online payments
    await expect(rowWith(page, alice)).toHaveCount(0);
    await page.getByLabel('Paid by').selectOption('OFFLINE');
    await expect(rowWith(page, alice)).toHaveCount(1);

    // Date range ("Played"): far in the past excludes them.
    await page.getByLabel('Played to').fill('2020-01-01');
    await expect(rowWith(page, alice)).toHaveCount(0);
    await page.getByLabel('Played to').fill('');
    await page.getByLabel('Played from').fill(day);
    await page.getByLabel('Played to').fill(day);
    await expect(rowWith(page, alice)).toHaveCount(1);

    await rowWith(page, alice).getByRole('link', { name: /View/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
    await expect(page.getByText(alice)).toBeVisible();
  });

  test('more than one page of bookings is paged, 25 at a time', async ({ page, makeVenue, ownerApi }) => {
    test.setTimeout(150_000);
    const venue: PwVenue = await makeVenue();
    // 28 bookings on the all-day court: four days x seven hours (a page holds 25).
    const days = [3, 4, 5, 6].map((d) => nextIstDay(d));
    let n = 0;
    for (const day of days) {
      for (const hour of [7, 8, 9, 10, 11, 12, 13]) {
        await walkIn(ownerApi, venue.courtId, day, hour, uniquePhone(), `PW Bulk ${++n}`);
      }
    }

    await page.goto('/bookings');
    await page.getByLabel('Venue').selectOption({ label: venue.name });
    await expect(page.getByText('1–25 of 28')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(25);
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('26–28 of 28')).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Changing a filter starts again at page 1.
    await page.getByLabel('Search bookings').fill('PW Bulk 1');
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0); // 11 matches fit on one page
    await expect.poll(() => page.locator('tbody tr').count()).toBeGreaterThanOrEqual(10); // 'PW Bulk 1' and 10-19
  });
});

test.describe('owner portal: payments, refunds, notifications, settings', () => {
  test('payments and refunds have a search, filters and a table or empty state', async ({ page }) => {
    for (const [path, heading, status] of [
      ['/payments', 'Payments', 'SUCCESS'],
      ['/refunds', 'Refunds', 'COMPLETED'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByRole('searchbox')).toBeVisible();
      await page.getByLabel('Status').selectOption(status);
      await page.getByLabel('Date from').or(page.getByLabel('Date').first()).first().isVisible();
      // (the status filter alone can already empty the list, so wait for the typed search itself to be applied)
      const searched = page.waitForResponse((r) => r.url().includes('zzz-no-such-thing-zzz') && r.ok());
      await page.getByRole('searchbox').fill('zzz-no-such-thing-zzz');
      await searched;
      await expect(page.getByText(new RegExp(`No ${heading.toLowerCase()} match your search or filters`))).toBeVisible();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page.getByRole('searchbox')).toHaveValue('');
    }
  });

  test('notifications can be searched and filtered', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Unread/ })).toBeVisible();
    await page.getByLabel('Search notifications').fill('zzz-no-such-notification-zzz');
    await expect(page.getByText(/No notifications match your filters|Nothing matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await page.getByRole('tab', { name: /Unread/ }).click();
    await expect(page.getByRole('tab', { name: /Unread/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('settings shows the account and the change-password form', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change Password' })).toBeVisible();
    await expect(page.getByText('Role', { exact: true })).toBeVisible();
    await expect(page.getByText('OWNER_ADMIN')).toBeVisible();
  });
});
