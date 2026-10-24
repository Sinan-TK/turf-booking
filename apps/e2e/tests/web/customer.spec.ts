import { logIn, searchNear, settled, shareLocation } from '../../support/customer-ui';
import { addDays, isoWeekday, istInstant, istToday, uniquePhone } from '../../support/dates';
import { unique, URLS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

test.describe('customer site: booking a slot', () => {
  test('a logged-in customer holds a slot, sees checkout, and finds it under My bookings', async ({ page, context, remoteVenue }) => {
    test.setTimeout(150_000);
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    await logIn(page, uniquePhone(), 'PW Booker');
    await settled(page);

    // The third day chip (two days from today) and the 10 AM turf slot, priced by that day's weekday.
    const day = addDays(istToday(), 2);
    const price = isoWeekday(day) >= 6 ? 1000 : 800;
    await page.getByRole('button', { name: /\d+ [A-Za-z]{3}$/ }).nth(2).click();
    await settled(page);
    const turf = page.locator('article').filter({ hasText: remoteVenue.name }).filter({ hasText: 'Turf A' });
    await turf.getByRole('button', { name: new RegExp('^10:00 AM ₹' + price) }).click();

    // Checkout: the held slot, its price and a running hold timer. Nothing is paid.
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByText(/^Order BK\d+/)).toBeVisible();
    await expect(page.getByRole('heading', { name: remoteVenue.name })).toBeVisible();
    await expect(page.getByText('PENDING_PAYMENT')).toBeVisible();
    await expect(page.getByText('10:00 AM – 11:00 AM')).toBeVisible();
    await expect(page.getByText('Turf A · 5S')).toBeVisible();
    await expect(page.getByText('INR ' + price)).toBeVisible();
    await expect(page.getByText(/Slot held for \d+:\d\d/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pay online' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /Pay with Coins/ })).toBeDisabled(); // a new customer has no coins
    await expect(page.getByText(/never both for the same booking\./)).toBeVisible();
    // The cancellation windows are shown before paying, as times, and refunds are only ever coins.
    await expect(page.getByText('Cancelling', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Until .*: (full refund|\d+% back|no refund) as coins$/).first()).toBeVisible();
    await expect(page.getByText(/can't be cancelled\.$/)).toBeVisible();
    await expect(page.getByText('Refunds are always paid as coins you can use on your next booking.')).toBeVisible();

    // The same customer cannot hold the same slot twice.
    const checkoutUrl = page.url();
    const again = await page.request.post(`${URLS.api}/bookings/hold`, {
      data: { resourceId: remoteVenue.turfId, startTime: istInstant(day, 10), durationMinutes: 60 },
    });
    expect(again.status()).toBe(409);

    // My bookings lists it as awaiting payment and links back to checkout.
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: /My bookings|Bookings/ }).first()).toBeVisible();
    const row = page.getByRole('link').filter({ hasText: /BK\d+/ }); // (the list shows the order, time, type and amount, not the venue)
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('PENDING_PAYMENT');
    await row.click();
    await expect(page).toHaveURL(checkoutUrl);
  });
});

test.describe('customer site: account and support', () => {
  test('the account page shows the profile and wallet, and a changed name is saved', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    const phone = uniquePhone();
    await logIn(page, phone, 'PW Original');

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    // The details are shown as text; Edit turns them into fields.
    await expect(page.getByText('PW Original')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit' }).click();
    const name = page.getByRole('textbox').nth(0);
    const save = page.getByRole('button', { name: 'Save' });
    await expect(name).toHaveValue('PW Original');
    await expect(save).toBeDisabled(); // nothing changed yet

    await name.fill('');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Enter your name.')).toBeVisible();

    await name.fill(`PW Renamed ${unique()}`);
    await expect(save).toBeEnabled();
    const renamed = await name.inputValue();
    const saved = page.waitForResponse((r) => r.request().method() !== 'GET' && r.url().includes('/me') && r.ok());
    await save.click();
    await saved;
    await expect(page.getByText('Saved.')).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0); // back to the read-only view
    await page.reload();
    await expect(page.getByText(renamed)).toBeVisible();

    // The wallet is its own tab.
    await page.getByRole('tab', { name: 'Wallet' }).click();
    await expect(page).toHaveURL(/\/account\?tab=wallet$/);
    await expect(page.getByRole('heading', { name: 'Coins wallet' })).toBeVisible();
    await expect(page.getByText('No transactions yet.')).toBeVisible();
  });

  test('a customer can ask support for help and sees the request listed', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    await logIn(page, uniquePhone(), 'PW Helper');

    await page.goto('/support');
    await expect(page.getByRole('heading', { name: 'Contact support' })).toBeVisible();
    await expect(page.getByText('No requests yet.')).toBeVisible();

    const send = page.getByRole('button', { name: /Send|Submit/ });
    await expect(send).toBeEnabled();
    await send.click(); // a subject and details are needed: each field says so
    await expect(page.getByText('Enter a subject.')).toBeVisible();
    await expect(page.getByText('Tell us what happened.')).toBeVisible();
    const subject = `PW question ${unique()}`;
    await page.locator('label').filter({ hasText: 'Subject' }).locator('xpath=following-sibling::*[1]').fill(subject);
    await page.locator('label').filter({ hasText: 'Details' }).locator('xpath=following-sibling::*[1]').fill('This is a ticket made by the Playwright suite.');
    await expect(page.getByText('Enter a subject.')).toHaveCount(0);
    await expect(page.getByText('Tell us what happened.')).toHaveCount(0);
    await send.click();
    await expect(page.getByText(/we have your request/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your requests' })).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();
  });

  test('pages that need a login send a signed-out visitor to log in', async ({ page }) => {
    for (const path of ['/account', '/bookings', '/support']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Log in' }).first()).toBeVisible();
    }
  });
});
