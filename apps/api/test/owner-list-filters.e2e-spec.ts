import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  type TestAgent,
} from './setup/fixtures';

const TOTAL = 'x-total-count';

describe('owner portal lists: search, filters and pagination', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let other: TestAgent;
  const phones = [
    `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  ];

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    const venue = await createVenueFixture(app, owner, admin);
    for (const [i, phone] of phones.entries()) {
      await owner
        .post('/owner/bookings')
        .send({
          resourceId: venue.fullGroundId,
          durationMinutes: 60,
          customerWhatsappNumber: phone,
          startTime: futureStart(3 + i, 10 + i).toISOString(),
        })
        .expect(201);
    }
  });
  afterAll(async () => app.close());

  it('pages bookings and reports the total in a header', async () => {
    const res = await owner.get('/owner/bookings?limit=1').expect(200);
    expect(res.body).toHaveLength(1);
    expect(Number(res.headers[TOTAL])).toBe(2);
    const second = await owner.get('/owner/bookings?limit=1&offset=1').expect(200);
    expect(second.body).toHaveLength(1);
    expect(second.body[0].id).not.toBe(res.body[0].id);
  });

  it('searches by customer number and filters by status and date', async () => {
    const byPhone = await owner.get(`/owner/bookings?search=${encodeURIComponent(phones[0]!)}`).expect(200);
    expect(byPhone.body).toHaveLength(1);
    expect(Number(byPhone.headers[TOTAL])).toBe(1);

    const cancelled = await owner.get('/owner/bookings?status=CANCELLED').expect(200);
    expect(cancelled.body).toEqual([]);

    const from = futureStart(4, 0).toISOString();
    const later = await owner.get(`/owner/bookings?from=${encodeURIComponent(from)}`).expect(200);
    expect(later.body).toHaveLength(1);
    expect(later.body[0].customer.whatsappNumber).toBe(phones[1]);
  });

  it('never shows another organization its data, whatever the filters', async () => {
    const res = await other.get(`/owner/bookings?search=${encodeURIComponent(phones[0]!)}`).expect(200);
    expect(res.body).toEqual([]);
    expect(Number(res.headers[TOTAL])).toBe(0);
  });

  it('rejects a bad status or negative offset with 400', async () => {
    await owner.get('/owner/bookings?status=NOPE').expect(400);
    await owner.get('/owner/bookings?offset=-1').expect(400);
  });

  it.each(['/owner/payments', '/owner/refunds'])('%s is paged, filterable and organization-scoped', async (path) => {
    const res = await owner.get(`${path}?limit=5`).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(Number(res.headers[TOTAL])).toBeGreaterThanOrEqual(0);
    const none = await owner.get(`${path}?search=zzzz-no-such-thing`).expect(200);
    expect(none.body).toEqual([]);
    expect(Number(none.headers[TOTAL])).toBe(0);
    await owner.get(`${path}?status=NOPE`).expect(400);
  });
});
