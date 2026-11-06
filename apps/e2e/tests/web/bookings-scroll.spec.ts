import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * My bookings loads a page at a time and adds the next page as the list is scrolled to its end. A customer cannot sign in here
 * without the fake-Google test mode, so the server's answers (a customer, and 30 bookings in pages) are supplied directly.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c1', name: 'PW Customer', phone: '+919100000000', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };
const TOTAL = 30;

function bookingAt(i: number) {
  const start = new Date(Date.now() + (i + 1) * 3_600_000);
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    orderId: `BK${20000 + i}`,
    status: 'CONFIRMED',
    amount: '800.00',
    currency: 'INR',
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3_600_000).toISOString(),
    quantity: 1,
    groundType: '5S',
    venue: { name: `Venue ${i + 1}`, address: '12 Park Road' },
    resource: { name: 'Turf A', category: { name: 'Football', iconKey: 'football', iconSvg: null, unitLabel: 'Pitch' } },
    resourceGroup: null,
  };
}

test('My bookings adds the next page when the end of the list is scrolled to, until all are shown', async ({ page }) => {
  const asked: string[] = [];
  const cors = { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-expose-headers': 'X-Total-Count', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route(`${URLS.api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/customer-auth/me') return route.fulfill({ headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(customer) });
    if (url.pathname === '/me/bookings') {
      asked.push(url.search);
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      // The second page takes a moment, so the placeholder cards can be seen.
      if (offset > 0) await new Promise((r) => setTimeout(r, 800));
      const rows = Array.from({ length: Math.min(limit, Math.max(0, TOTAL - offset)) }, (_, k) => bookingAt(offset + k));
      return route.fulfill({ headers: { ...cors, 'content-type': 'application/json', 'x-total-count': String(TOTAL) }, body: JSON.stringify(rows) });
    }
    return route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account?tab=bookings');
  const cards = page.getByRole('list').locator('li').filter({ hasText: 'BK' });
  // The first page only: twelve cards, newest first.
  await expect(cards).toHaveCount(12);
  await expect(cards.first()).toContainText('BK20000');
  expect(asked[0]).toContain('limit=12');

  // Scrolling to the end brings the next twelve (with placeholder cards while they come), then the last six.
  await page.mouse.wheel(0, 5000);
  await expect(page.getByRole('status').filter({ hasText: 'Loading more bookings' })).toBeAttached();
  await expect(cards).toHaveCount(24);
  await page.mouse.wheel(0, 8000);
  await expect(cards).toHaveCount(30);
  await expect(page.getByText('That is all your bookings.')).toBeVisible();
  // Each booking is shown once, and nothing more is asked for.
  const names = await cards.allInnerTexts();
  expect(new Set(names.map((n) => n.match(/BK\d+/)![0])).size).toBe(30);
  const askedBefore = asked.length;
  await page.mouse.wheel(0, 8000);
  await page.waitForTimeout(800);
  expect(asked.length).toBe(askedBefore);
});
