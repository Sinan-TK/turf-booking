import { URLS } from '../../support/env';
import { logIn } from '../../support/customer-ui';
import { uniquePhone } from '../../support/dates';
import { expect, test } from '../../support/fixtures';

test.describe('customer site: coin balance in the header', () => {
  test('a coin icon and the count sit just before the profile button, and tapping opens the wallet', async ({ page, adminApi }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /coins\. Open your wallet/ })).toHaveCount(0); // signed out: nothing
    await logIn(page, uniquePhone(), 'PW Coin Person');

    const coins = page.getByRole('link', { name: /coins\. Open your wallet/ });
    await expect(coins).toBeVisible();
    await expect(coins).toHaveAttribute('aria-label', '0 coins. Open your wallet'); // a new customer has none
    await expect(coins.locator('svg')).toBeVisible(); // the coin icon

    // It is directly before the profile button, on the same line.
    const chip = (await coins.boundingBox())!;
    const profile = (await page.getByRole('button', { name: 'Account menu' }).boundingBox())!;
    expect(chip.x + chip.width).toBeLessThanOrEqual(profile.x);
    expect(profile.x - (chip.x + chip.width)).toBeLessThan(24);
    expect(Math.abs(chip.y + chip.height / 2 - (profile.y + profile.height / 2))).toBeLessThan(4);

    // Credit some coins as the admin would: the count follows when the person comes back to the page.
    const me = await page.request.get(`${URLS.api}/customer-auth/me`);
    const { id } = (await me.json()) as { id: string };
    const credit = await adminApi.post('/admin/coins/adjust', { data: { customerId: id, signedAmount: 1250, reason: 'Playwright coin chip' } });
    expect(credit.ok(), await credit.text()).toBeTruthy();
    await page.reload();
    await expect(page.getByRole('link', { name: '1,250 coins. Open your wallet' })).toBeVisible();

    await page.getByRole('link', { name: '1,250 coins. Open your wallet' }).click();
    await expect(page).toHaveURL(/\/account\?tab=wallet$/);
    await expect(page.getByRole('heading', { name: 'Coins wallet' })).toBeVisible();
    await expect(page.getByText('1250').first()).toBeVisible();
  });
});
