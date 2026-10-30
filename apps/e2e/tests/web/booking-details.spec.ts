import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

/**
 * The customer's booking page shows which venue and what was booked. A customer cannot sign in here without the fake-Google test mode
 * the Docker stack does not run, so the server's answers are supplied directly (the same shape the API returns, which an API test
 * covers), and the page itself is what is checked.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c1', name: 'PW Customer', phone: '+919100000000', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };

function booking(extra: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orderId: 'BK12345',
    status: 'CONFIRMED',
    amount: '800.00',
    advanceAmount: '200.00',
    paidAmount: '200.00',
    currency: 'INR',
    startTime: '2026-11-21T12:30:00.000Z', // 18:00 in Kolkata
    endTime: '2026-11-21T14:30:00.000Z',
    groundType: '5S',
    paymentMethod: 'MONEY',
    quantity: 1,
    venue: { id: 'v1', name: 'Greenfield Sports Arena', address: '12 Park Road, Manjeri', facilityCode: 'GRN-001', googleMapsUrl: null, lat: 11.12, lng: 76.12 },
    resourceName: '5s Ground A',
    facility: { name: 'Football', unitLabel: 'Pitch' },
    ...extra,
  };
}

async function open(page: import('@playwright/test').Page, view: Record<string, unknown>) {
  const cors = { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  await page.route(`${URLS.api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (url.pathname === '/customer-auth/me') return json(customer);
    if (url.pathname.endsWith('/cancellation')) return json({ canCancel: true, currency: 'INR', paidOnline: '200.00', now: { refundPercent: 100, refundCoins: '200.00' }, windows: [], closesAt: '2026-11-21T10:30:00.000Z' });
    if (url.pathname.startsWith('/me/bookings/')) return json(view);
    return route.continue();
  });
  await page.goto(`/bookings/${view.id}`);
}

test.describe('customer site: booking details', () => {
  test('shows the venue with its address and directions, when, and exactly what was booked', async ({ page }) => {
    await open(page, booking());
    await expect(page.getByRole('heading', { name: 'Booking Details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Greenfield Sports Arena' })).toBeVisible();
    await expect(page.getByText('12 Park Road, Manjeri')).toBeVisible();
    await expect(page.getByText('Order BK12345')).toBeVisible();

    // Directions: a pin at the venue's coordinates, since it has no map link of its own.
    await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', /destination=11\.12,76\.12/);

    // When: the day, the times and how long.
    const when = page.locator('dl > div').filter({ hasText: /^When/ });
    await expect(when).toContainText('2 hours');
    await expect(when).toContainText(/Nov/);

    // What was booked: the unit, its type and the kind of venue.
    const booked = page.locator('dl > div').filter({ hasText: /^Booked/ });
    await expect(booked).toContainText('5s Ground A · 5S');
    await expect(booked).toContainText('Football');

    // The money lines that were already there are still there.
    await expect(page.getByText('Pay at the venue')).toBeVisible();
  });

  test("uses the venue's own map link when it has one, and shows a pooled item with its quantity", async ({ page }) => {
    await open(
      page,
      booking({
        venue: { id: 'v2', name: 'Lakeside Kayaking', address: 'Dam Road, Nilambur', facilityCode: 'LKS-002', googleMapsUrl: 'https://maps.app.goo.gl/PwLakeside', lat: 0, lng: 0 },
        resourceName: 'Kayaks',
        groundType: '',
        quantity: 3,
        facility: { name: 'Kayaking', unitLabel: 'Kayak' },
        startTime: '2026-11-21T04:30:00.000Z',
        endTime: '2026-11-21T05:00:00.000Z',
      }),
    );
    await expect(page.getByRole('heading', { name: 'Lakeside Kayaking' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', 'https://maps.app.goo.gl/PwLakeside');
    const booked = page.locator('dl > div').filter({ hasText: /^Booked/ });
    await expect(booked).toContainText('3 × Kayaks');
    await expect(booked).toContainText('Kayaking');
    await expect(page.locator('dl > div').filter({ hasText: /^When/ })).toContainText('30 minutes');
  });
});
