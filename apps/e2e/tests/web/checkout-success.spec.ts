import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * The checkout after paying: the success animation, then the booking page by itself (no WhatsApp wording); a payment still being
 * confirmed shows its own state; and a booking confirmed before the page was opened skips the animation. A customer cannot sign in here
 * without the fake-Google test mode, so the server's answers are supplied directly.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c1', name: 'PW Customer', phone: '+919100000000', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };
const ID = '11111111-1111-4111-8111-111111111111';

function booking(extra: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 3 * 86_400_000);
  return {
    id: ID,
    orderId: 'BK777',
    customerId: 'c1',
    status: 'PENDING_PAYMENT',
    amount: '800.00',
    advanceAmount: '200.00',
    paidAmount: '0.00',
    currency: 'INR',
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3_600_000).toISOString(),
    durationMinutes: 60,
    groundType: '5S',
    paymentMethod: null,
    coinsPaid: '0.00',
    moneyPaid: '0.00',
    quantity: 1,
    venue: { id: 'v1', name: 'Greenfield Sports Arena', address: '12 Park Road', facilityCode: 'GRN-1', googleMapsUrl: null, lat: 11, lng: 76, contactPhone: null },
    resourceName: '5s Ground A',
    facility: { name: 'Football', unitLabel: 'Pitch' },
    holdExpiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    serverNow: new Date().toISOString(),
    ...extra,
  };
}

async function open(page: import('@playwright/test').Page, state: { current: Record<string, unknown> }, wallet = '1000.00') {
  const cors = { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route(`${URLS.api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/customer-auth/me') return json(customer);
    if (url.pathname === '/me/coins') return json({ cachedBalance: wallet, currency: 'INR', topupMin: 50, topupMax: 10000 });
    if (url.pathname.endsWith('/cancellation')) return json({ canCancel: true, currency: 'INR', paidOnline: '0', now: null, windows: [], closesAt: null });
    if (url.pathname.startsWith('/payments/sync/')) return json({ status: state.current.status });
    if (url.pathname.endsWith('/pay-with-coins')) {
      state.current = booking({ status: 'CONFIRMED', paymentMethod: 'COINS', coinsPaid: '200.00', paidAmount: '200.00' });
      return json(state.current, 201);
    }
    if (url.pathname.startsWith('/me/bookings/')) return json(state.current);
    return route.continue();
  });
}

test.describe('customer site: after paying at the checkout', () => {
  test('paying with Coins shows the success animation, then opens the booking page, with no WhatsApp wording', async ({ page }) => {
    const state = { current: booking() };
    await open(page, state);
    await page.goto(`/checkout/${ID}`);
    await expect(page.getByRole('button', { name: /^Pay with Coins/ })).toBeEnabled();
    await expect(page.getByText(/whatsapp/i)).toHaveCount(0);
    await page.getByRole('button', { name: /^Pay with Coins/ }).click();

    const success = page.getByRole('status', { name: 'Payment successful' });
    await expect(success).toBeVisible();
    await expect(success).toContainText('₹200');
    await expect(success).toContainText('Paid with Coins');
    await expect(success.getByText(/whatsapp/i)).toHaveCount(0);

    await expect(page).toHaveURL(new RegExp(`/bookings/${ID}$`), { timeout: 10_000 });
  });

  test('"View booking" skips the wait', async ({ page }) => {
    const state = { current: booking() };
    await open(page, state);
    await page.goto(`/checkout/${ID}`);
    await page.getByRole('button', { name: /^Pay with Coins/ }).click();
    await page.getByRole('button', { name: 'View booking' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${ID}$`));
  });

  test('a booking that is already confirmed goes straight to its page, without the animation', async ({ page }) => {
    const state = { current: booking({ status: 'CONFIRMED', paymentMethod: 'MONEY', moneyPaid: '200.00', paidAmount: '200.00' }) };
    await open(page, state);
    await page.goto(`/checkout/${ID}`);
    await expect(page).toHaveURL(new RegExp(`/bookings/${ID}$`));
    await expect(page.getByRole('status', { name: 'Payment successful' })).toHaveCount(0);
  });

  test('a payment still being confirmed shows the processing state, then the success animation once the bank confirms', async ({ page }) => {
    const state = { current: booking({ status: 'PROCESSING', processingUntil: new Date(Date.now() + 5 * 60_000).toISOString() }) };
    await open(page, state);
    await page.goto(`/checkout/${ID}`);
    await expect(page.getByText('Confirming your payment…').first()).toBeVisible();
    await expect(page.getByText(/waiting for the bank/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pay online/ })).toHaveCount(0);

    state.current = booking({ status: 'CONFIRMED', paymentMethod: 'MONEY', moneyPaid: '200.00', paidAmount: '200.00' });
    await expect(page.getByRole('status', { name: 'Payment successful' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('status', { name: 'Payment successful' })).toContainText('Paid online');
  });

  test('a booking whose payment was never confirmed says so and offers another time', async ({ page }) => {
    const state = { current: booking({ status: 'FAILED' }) };
    await open(page, state);
    await page.goto(`/checkout/${ID}`);
    await expect(page.getByText(/could not confirm your payment/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Choose another time' })).toBeVisible();
  });

  test('with too few Coins the button is off and a link adds the missing amount to the wallet', async ({ page }) => {
    const state = { current: booking() };
    await open(page, state, '50.00');
    await page.goto(`/checkout/${ID}`);
    await expect(page.getByRole('button', { name: /^Pay with Coins/ })).toBeDisabled();
    await expect(page.getByText(/You need ₹150 more Coins/)).toBeVisible();
    const link = page.getByRole('link', { name: 'Add money to your wallet' });
    await expect(link).toHaveAttribute('href', /tab=wallet&add=150&back=/);
  });

  test('the booking page shows a processing banner for a payment being confirmed', async ({ page }) => {
    const state = { current: booking({ status: 'PROCESSING', processingUntil: new Date(Date.now() + 4 * 60_000).toISOString() }) };
    await open(page, state);
    await page.goto(`/bookings/${ID}`);
    await expect(page.getByText('Payment received, confirming…')).toBeVisible();
  });

  function confirmedWith(options: { contactCall: boolean; contactWhatsapp: boolean }) {
    return {
      current: booking({
        status: 'CONFIRMED',
        paymentMethod: 'MONEY',
        moneyPaid: '200.00',
        paidAmount: '200.00',
        venue: { id: 'v1', name: 'Greenfield Sports Arena', address: '12 Park Road', facilityCode: 'GRN-1', googleMapsUrl: null, lat: 11, lng: 76, contactPhone: '+919847012345', ...options },
      }),
    };
  }

  test('a confirmed booking shows the venue number with a Call icon when Call is on', async ({ page }) => {
    await open(page, confirmedWith({ contactCall: true, contactWhatsapp: false }));
    await page.goto(`/bookings/${ID}`);
    await expect(page.getByText('Venue contact')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call Greenfield Sports Arena' }).first()).toHaveAttribute('href', 'tel:+919847012345');
    await expect(page.getByRole('link', { name: /^WhatsApp/ })).toHaveCount(0);
    await expect(page.getByText('Paid online')).toHaveCount(1);
  });

  test('WhatsApp on shows a WhatsApp icon that opens a chat with the number', async ({ page }) => {
    await open(page, confirmedWith({ contactCall: false, contactWhatsapp: true }));
    await page.goto(`/bookings/${ID}`);
    const link = page.getByRole('link', { name: 'WhatsApp Greenfield Sports Arena' }).first();
    await expect(link).toHaveAttribute('href', 'https://wa.me/919847012345');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: /^Call / })).toHaveCount(0);
  });

  test('with both on both icons show, with both off none do', async ({ page }) => {
    await open(page, confirmedWith({ contactCall: true, contactWhatsapp: true }));
    await page.goto(`/bookings/${ID}`);
    await expect(page.getByRole('link', { name: /^Call / }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^WhatsApp / }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/contact-icons.png' });
  });

  test('with both off no contact icon is shown', async ({ page }) => {
    await open(page, confirmedWith({ contactCall: false, contactWhatsapp: false }));
    await page.goto(`/bookings/${ID}`);
    await expect(page.getByText('Paid online')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /^(Call|WhatsApp) / })).toHaveCount(0);
  });
});
