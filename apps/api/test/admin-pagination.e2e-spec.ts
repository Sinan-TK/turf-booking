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
