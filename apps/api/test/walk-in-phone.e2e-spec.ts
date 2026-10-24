import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, futureStart, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

/**
 * A walk-in is booked by venue staff typing the customer's number. It must be a real Indian mobile number, and
 * however it is written it is stored the same way, so the same person is never two customers.
 */
describe('walk-in customer phone numbers', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let resourceId: string;
  let day = 3;
  const last8 = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  const walkIn = (customerWhatsappNumber: string) =>
    owner.post('/owner/bookings').send({
      resourceId,
      durationMinutes: 60,
      customerWhatsappNumber,
      startTime: futureStart(day++, 10).toISOString(),
    });

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    resourceId = (await createVenueFixture(app, owner, admin)).fullGroundId;
  });
  afterAll(async () => app.close());

  it('refuses a number that is not an Indian mobile number, with the reason', async () => {
    for (const bad of ['12345', '5876543210', '9999999999', '+14155550123', 'abc']) {
      const res = await walkIn(bad);
      expect(res.status).toBe(400);
    }
    const res = await walkIn('5876543210');
    expect(JSON.stringify(res.body)).toMatch(/10-digit Indian mobile number/);
  });

  it('stores every spelling of a number the same way, so it is one customer', async () => {
    const national = `98${last8()}`;
    const spellings = [national, `+91 ${national.slice(0, 5)} ${national.slice(5)}`, `91${national}`, `0${national}`];
    const ids = new Set<string>();
    for (const s of spellings) {
      const res = await walkIn(s);
      expect(res.status).toBe(201);
      ids.add(res.body.customerId);
    }
    expect(ids.size).toBe(1);
    const rows = await prisma.customerProfile.findMany({ where: { whatsappNumber: { contains: national } } });
    expect(rows.map((r) => r.whatsappNumber)).toEqual([`+91${national}`]);
  });
});
