import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

const TOTAL = 'x-total-count';

describe('admin list pagination (limit, offset, X-Total-Count)', () => {
  let app: INestApplication;
  let admin: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => app.close());

  const lists = [
    '/admin/bookings',
    '/admin/payments',
    '/admin/refunds',
    '/admin/support-tickets',
    '/admin/customers',
  ];

  describe.each(lists)('%s', (path) => {
    it('returns an array, honours limit and reports the total in a header', async () => {
      const res = await admin.get(`${path}?limit=2`).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(2);
      const total = Number(res.headers[TOTAL]);
      expect(Number.isInteger(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(res.body.length);
    });

    it('returns nothing (but the same total) past the end', async () => {
      const first = await admin.get(`${path}?limit=1`).expect(200);
      const total = Number(first.headers[TOTAL]);
      const past = await admin.get(`${path}?limit=5&offset=${total + 10}`).expect(200);
      expect(past.body).toEqual([]);
      expect(Number(past.headers[TOTAL])).toBe(total);
    });

    it('rejects a negative offset and a non-numeric limit with 400', async () => {
      await admin.get(`${path}?offset=-1`).expect(400);
      await admin.get(`${path}?limit=abc`).expect(400);
    });
  });

  it('pages do not overlap', async () => {
    const a = await admin.get('/admin/bookings?limit=5&offset=0').expect(200);
    const b = await admin.get('/admin/bookings?limit=5&offset=5').expect(200);
    expect(a.body.length).toBe(5);
    expect(b.body.length).toBe(5);
    const ids = new Set(a.body.map((r: { id: string }) => r.id));
    expect(b.body.some((r: { id: string }) => ids.has(r.id))).toBe(false);
  });

  it('caps the page size at 200', async () => {
    const res = await admin.get('/admin/bookings?limit=5000').expect(200);
    expect(res.body.length).toBeLessThanOrEqual(200);
  });

  it('the total follows the filter', async () => {
    const all = await admin.get('/admin/bookings?limit=1').expect(200);
    const confirmed = await admin.get('/admin/bookings?limit=1&status=CONFIRMED').expect(200);
    expect(Number(confirmed.headers[TOTAL])).toBeLessThanOrEqual(Number(all.headers[TOTAL]));
    const none = await admin.get('/admin/customers?search=zzzz-no-such-customer&limit=5').expect(200);
    expect(none.body).toEqual([]);
    expect(Number(none.headers[TOTAL])).toBe(0);
  });
});

describe('admin list search and filters', () => {
  let app: INestApplication;
  let admin: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => app.close());

  const total = (res: { headers: Record<string, string> }) => Number(res.headers[TOTAL]);

  it.each([
    ['/admin/bookings', 'status=NOPE'],
    ['/admin/bookings', 'paymentMethod=NOPE'],
    ['/admin/bookings', 'from=not-a-date'],
    ['/admin/payments', 'provider=NOPE'],
    ['/admin/refunds', 'status=NOPE'],
    ['/admin/support-tickets', 'priority=NOPE'],
    ['/admin/support-tickets', 'category=NOPE'],
    ['/admin/customers', 'status=NOPE'],
  ])('%s?%s is a 400', async (path, qs) => {
    await admin.get(`${path}?${qs}`).expect(400);
  });

  it('rejects an inverted date range', async () => {
    await admin.get('/admin/payments?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z').expect(400);
  });

  it.each(['/admin/bookings', '/admin/payments', '/admin/refunds', '/admin/support-tickets', '/admin/customers'])(
    '%s finds nothing for a search term that matches nothing',
    async (path) => {
      const res = await admin.get(`${path}?search=zzzz-no-such-thing`).expect(200);
      expect(res.body).toEqual([]);
      expect(total(res)).toBe(0);
    },
  );

  it('a booking search by order id finds exactly that booking', async () => {
    const [first] = (await admin.get('/admin/bookings?limit=1').expect(200)).body;
    if (!first) return;
    const res = await admin.get(`/admin/bookings?search=${first.orderId}`).expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toContain(first.id);
    const lower = await admin.get(`/admin/bookings?search=${first.orderId.toLowerCase()}`).expect(200);
    expect(total(lower)).toBe(total(res));
  });

  it('combined filters narrow the result', async () => {
    const all = await admin.get('/admin/bookings?limit=1').expect(200);
    const narrowed = await admin
      .get('/admin/bookings?limit=1&status=CONFIRMED&paymentMethod=MONEY&from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')
      .expect(200);
    expect(total(narrowed)).toBeLessThanOrEqual(total(all));
    const future = await admin.get('/admin/bookings?from=2100-01-01T00:00:00Z').expect(200);
    expect(total(future)).toBe(0);
  });

  it('customers can be filtered by status', async () => {
    const active = await admin.get('/admin/customers?status=ACTIVE&limit=200').expect(200);
    for (const c of active.body) expect(c.status).toBe('ACTIVE');
  });
});
