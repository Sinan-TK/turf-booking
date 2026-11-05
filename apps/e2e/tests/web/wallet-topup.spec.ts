import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * The wallet page's "Add money": the sheet, its amount rules, and opening by itself with the missing amount when the checkout sent the
 * customer here. (The Razorpay popup itself is the gateway's; the server side of a recharge is covered by the API tests.) The account
 * and the wallet are supplied directly: a customer cannot sign in here without the fake-Google test mode.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c1', name: 'PW Customer', phone: '+919100000000', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };

// 11 rows: a recharge still waiting, a debit, and credits, newest first (two pages of 8).
const HISTORY = [
  { id: 'h0', type: 'WALLET_TOPUP', amount: '300.00', balanceAfter: null, createdAt: new Date(Date.now() - 60_000).toISOString(), status: 'PENDING' },
  { id: 'h1', type: 'BOOKING_REDEMPTION', amount: '-200.00', balanceAfter: '120.00', createdAt: new Date(Date.now() - 3_600_000).toISOString(), status: 'COMPLETED', bookingId: 'b1' },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `h${i + 2}`,
    type: i % 2 ? 'REFUND' : 'WALLET_TOPUP',
    amount: '100.00',
    balanceAfter: String(320 - i * 10),
    createdAt: new Date(Date.now() - (i + 2) * 86_400_000).toISOString(),
    status: 'COMPLETED',
  })),
];

async function open(page: import('@playwright/test').Page) {
  const cors = { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route(`${URLS.api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/customer-auth/me') return json(customer);
    if (url.pathname === '/me/coins') return json({ cachedBalance: '120.00', currency: 'INR', topupMin: 100, topupMax: 2000 });
    if (url.pathname === '/me/coins/transactions') {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json', 'access-control-expose-headers': 'X-Total-Count', 'x-total-count': String(HISTORY.length) },
        body: JSON.stringify(HISTORY.slice(offset, offset + limit)),
      });
    }
    return route.continue();
  });
}

test.describe('customer site: wallet Add money', () => {
  test('the wallet shows the balance in rupees, the Add money button, and a top-up in the history', async ({ page }) => {
    await open(page);
    await page.goto('/account?tab=wallet');
    await expect(page.getByText('₹120').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add money' })).toBeVisible();
    await expect(page.getByText('Added to wallet').first()).toBeVisible();
  });

  test('the history marks Coins in green, Coins out in red and a waiting recharge in yellow, and pages through the rest', async ({ page }) => {
    await open(page);
    await page.goto('/account?tab=wallet');
    const history = page.getByRole('region', { name: 'Coin history' });
    await expect(history.getByRole('listitem')).toHaveCount(8);

    const waiting = history.getByRole('listitem').filter({ hasText: 'Pending' });
    await expect(waiting).toHaveCount(1);
    await expect(waiting.getByText('₹300')).toHaveClass(/text-yellow-700/);

    const spent = history.getByRole('listitem').filter({ hasText: 'Used for a booking' });
    await expect(spent.getByText('−₹200')).toHaveClass(/text-red-700/);
    await expect(spent.getByRole('link')).toHaveAttribute('href', '/bookings/b1');

    const credit = history.getByRole('listitem').filter({ hasText: 'Cancellation refund' }).first();
    await expect(credit.getByText('+₹100')).toHaveClass(/text-green-700/);

    await expect(history.getByText('1–8 of 11')).toBeVisible();
    await expect(history.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await history.getByRole('button', { name: 'Next' }).click();
    await expect(history.getByText('9–11 of 11')).toBeVisible();
    await expect(history.getByRole('listitem')).toHaveCount(3);
    await expect(history.getByRole('button', { name: 'Next' })).toBeDisabled();
    await history.getByRole('button', { name: 'Previous' }).click();
    await expect(history.getByRole('listitem')).toHaveCount(8);
  });

  test('the sheet offers quick amounts and explains what is wrong with an amount that is not allowed', async ({ page }) => {
    await open(page);
    await page.goto('/account?tab=wallet');
    await page.getByRole('button', { name: 'Add money' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add money to wallet' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/not returned to your card/)).toBeVisible();

    await sheet.getByRole('button', { name: '₹1,000' }).click();
    await expect(sheet.getByLabel('Amount')).toHaveValue('1000');
    await expect(sheet.getByRole('button', { name: 'Pay ₹1,000' })).toBeEnabled();

    await sheet.getByLabel('Amount').fill('50');
    await expect(sheet.getByText('The least you can add is ₹100.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Add money' })).toBeDisabled();

    await sheet.getByLabel('Amount').fill('2500');
    await expect(sheet.getByText('The most you can add at a time is ₹2,000.')).toBeVisible();

    await sheet.getByLabel('Amount').fill('50.555');
    await expect(sheet.getByText('Use at most two decimals.')).toBeVisible();

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  });

  test('sent here from the checkout with the missing amount, the sheet opens by itself with that amount', async ({ page }) => {
    await open(page);
    await page.goto('/account?tab=wallet&add=300&back=%2Fcheckout%2Fabc');
    const sheet = page.getByRole('dialog', { name: 'Add money to wallet' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Amount')).toHaveValue('300');
  });
});
