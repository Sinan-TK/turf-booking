import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  agentFor,
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
  type TestAgent,
} from './setup/fixtures';

/**
 * A walk-in is booked by venue staff for someone without an account. Its name and phone are kept on the booking
 * itself: no customer account is looked up, created or touched, and it never shows under anyone's My bookings.
 * The number must still be a real Indian mobile number.
 */
describe('walk-in bookings keep their customer details on the booking only', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let admin: TestAgent;
  let resourceId: string;
  let day = 3;
  const last8 = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  const walkIn = (customerWhatsappNumber: string, customerName?: string) =>
    owner.post('/owner/bookings').send({
      resourceId,
      durationMinutes: 60,
      customerWhatsappNumber,
      ...(customerName ? { customerName } : {}),
      startTime: futureStart(day++, 10).toISOString(),
    });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    resourceId = (await createVenueFixture(app, owner, admin)).fullGroundId;
  });
  afterAll(async () => app.close());

  it('refuses a number that is not an Indian mobile number, with the reason', async () => {
    for (const bad of ['12345', '5876543210', '9999999999', '+14155550123', 'abc']) {
      expect((await walkIn(bad)).status).toBe(400);
    }
    expect(JSON.stringify((await walkIn('5876543210')).body)).toMatch(/10-digit Indian mobile number/);
  });

  it('stores the name and the canonical phone on the booking and creates no customer account', async () => {
    const national = `98${last8()}`;
    const before = await prisma.customerProfile.count();
    const res = await walkIn(`+91 ${national.slice(0, 5)} ${national.slice(5)}`, '  Walk In Wally ');
    expect(res.status).toBe(201);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ customerId: null, walkInName: 'Walk In Wally', walkInPhone: `+91${national}`, paymentMethod: 'OFFLINE' });
    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: row.slotHoldId } })).customerId).toBeNull();
    expect(await prisma.customerProfile.count()).toBe(before); // nobody was created
    expect(await prisma.customerProfile.count({ where: { whatsappNumber: { contains: national } } })).toBe(0);
  });

  it('does not match an existing customer who has the same number, and is not in their My bookings', async () => {
    // A customer who is signed in with a verified number.
    const { agent: theirs, whatsappNumber, customerId } = await createCustomerFixture(app);
    const national = whatsappNumber.slice(3);

    const res = await walkIn(national, 'Someone Else');
    expect(res.status).toBe(201);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.customerId).toBeNull();

    const mine = await theirs.get('/me/bookings').expect(200);
    expect(mine.body.find((b: { id: string }) => b.id === res.body.id)).toBeUndefined();
    expect(mine.body).toHaveLength(0);
    // Nothing about the customer account changed either.
    expect(await prisma.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({ whatsappNumber, phoneVerified: true });
  });

  it('shows the recorded details as the customer in the owner and admin screens, flagged as a walk-in, and finds it by them', async () => {
    const national = `96${last8()}`;
    const tag = uniqueSuffix();
    const created = await walkIn(national, `Guest ${tag}`);
    expect(created.status).toBe(201);

    const detail = await owner.get(`/owner/bookings/${created.body.id}`).expect(200);
    expect(detail.body.isWalkIn).toBe(true);
    expect(detail.body.customer).toEqual({ id: null, name: `Guest ${tag}`, whatsappNumber: `+91${national}`, phoneVerified: false, email: null });
    expect(detail.body.walkInName).toBeUndefined();

    for (const path of ['/owner/bookings', '/admin/bookings']) {
      const list = await (path.startsWith('/owner') ? owner : admin).get(`${path}?search=${national}`).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ id: created.body.id, isWalkIn: true, customer: { name: `Guest ${tag}` } });
    }
    const byName = await owner.get(`/owner/bookings?search=${encodeURIComponent('Guest ' + tag)}`).expect(200);
    expect(byName.body.map((b: { id: string }) => b.id)).toContain(created.body.id);
  });

  it('can be cancelled by the venue without anyone to notify or refund', async () => {
    const created = await walkIn(`95${last8()}`, 'Cancel Me');
    const res = await owner.post(`/owner/bookings/${created.body.id}/cancel`).send({ reason: 'Rain' });
    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('CANCELLED');
    expect(res.body.refund).toBeNull();
  });

  it('keeps a walk-in out of the customer-side lookups entirely', async () => {
    const detail = await walkIn(`94${last8()}`);
    const stranger = agentFor(app);
    expect((await stranger.get(`/me/bookings/${detail.body.id}`)).status).toBe(401);
  });
});
