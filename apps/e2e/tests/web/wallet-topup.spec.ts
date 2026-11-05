import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * The wallet page's "Add money": the sheet, its amount rules, and opening by itself with the missing amount when the checkout sent the
 * customer here. (The Razorpay popup itself is the gateway's; the server side of a recharge is covered by the API tests.) The account
 * and the wallet are supplied directly: a customer cannot sign in here without the fake-Google test mode.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c1', name: 'PW Customer', phone: '+919100000000', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };

async function open(page: import('@playwright/test').Page) {
  const cors = { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route(`${URLS.api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/customer-auth/me') return json(customer);
    if (url.pathname === '/me/coins') return json({ cachedBalance: '120.00', currency: 'INR', topupMin: 50, topupMax: 10000 });
    if (url.pathname === '/me/coins/transactions') return json([{ id: 't1', type: 'WALLET_TOPUP', amount: '120.00', balanceAfter: '120.00', createdAt: new Date().toISOString() }]);
    return route.continue();
  });
}

test.describe('customer site: wallet Add money', () => {
  test('the wallet shows the balance in rupees, the Add money button, and a top-up in the history', async ({ page }) => {
    await open(page);
    await page.goto('/account?tab=wallet');
    await expect(page.getByText('₹120').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add money' })).toBeVisible();
    await expect(page.getByText('Added to wallet')).toBeVisible();
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

    await sheet.getByLabel('Amount').fill('10');
    await expect(sheet.getByText('The least you can add is ₹50.')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Add money' })).toBeDisabled();

    await sheet.getByLabel('Amount').fill('20000');
    await expect(sheet.getByText('The most you can add at a time is ₹10,000.')).toBeVisible();

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
