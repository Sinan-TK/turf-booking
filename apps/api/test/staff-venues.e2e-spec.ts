import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createOwnerFixture,
  createStaffFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

/**
 * Owner staff work only in the venues an owner admin assigned them: they see and book those venues'
 * bookings, and nothing else (no pricing, units, money pages, staff admin).
 */
describe('Venue-scoped owner staff', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let organizationId: string;
  let venueA: Awaited<ReturnType<typeof createVenueFixture>>;
  let venueB: Awaited<ReturnType<typeof createVenueFixture>>;
  let staff: TestAgent;
  let staffId: string;
  let bookingA: string;
  let bookingB: string;

  const phoneA = '+919100000001';
  const phoneB = '+919100000002';

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const fx = await createOwnerFixture(app, admin);
    owner = fx.ownerAgent;
    organizationId = fx.organizationId;
    venueA = await createVenueFixture(app, owner, admin);
    venueB = await createVenueFixture(app, owner, admin);
    ({ agent: staff, staffId } = await createStaffFixture(app, organizationId, [venueA.venueId]));

    const make = async (resourceId: string, phone: string, day: number, hour: number) =>
      (
        await owner
          .post('/owner/bookings')
          .send({
            resourceId,
            durationMinutes: 60,
            customerWhatsappNumber: phone,
            startTime: futureStart(day, hour).toISOString(),
          })
          .expect(201)
      ).body.id as string;
    bookingA = await make(venueA.fullGroundId, phoneA, 3, 10);
    bookingB = await make(venueB.fullGroundId, phoneB, 3, 12);
  }, 180_000); // two venues with units and prices, over the network
  afterAll(async () => app.close());

  jest.setTimeout(60_000);

  it('lists only the bookings of assigned venues', async () => {
    const res = await staff.get('/owner/bookings').expect(200);
    const ids = res.body.map((b: { id: string }) => b.id);
    expect(ids).toContain(bookingA);
    expect(ids).not.toContain(bookingB);
    // The owner admin still sees both.
    const all = await owner.get('/owner/bookings').expect(200);
    expect(all.body.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([bookingA, bookingB]));
  });

  it('refuses another venue by filter, detail, day view and walk-in', async () => {
    await staff.get(`/owner/bookings?venueId=${venueB.venueId}`).expect(403);
    await staff.get(`/owner/bookings/${bookingB}`).expect(403);
    await staff.get(`/owner/bookings/${bookingA}`).expect(200);
    const from = futureStart(3, 0).toISOString();
    const to = futureStart(4, 0).toISOString();
    await staff.get(`/owner/bookings/day?venueId=${venueB.venueId}&from=${from}&to=${to}`).expect(403);
    await staff
      .post('/owner/bookings')
      .send({
        resourceId: venueB.halfAId,
        durationMinutes: 60,
        customerWhatsappNumber: phoneA,
        startTime: futureStart(5, 10).toISOString(),
      })
      .expect(403);
  });

  it("day view returns an assigned venue's bookings for the day, in time order", async () => {
    const from = futureStart(3, 0).toISOString();
    const to = futureStart(4, 0).toISOString();
    const res = await staff.get(`/owner/bookings/day?venueId=${venueA.venueId}&from=${from}&to=${to}`).expect(200);
    expect(res.body.map((b: { id: string }) => b.id)).toEqual([bookingA]);
    await staff.get(`/owner/bookings/day?venueId=${venueA.venueId}`).expect(400);
  });

  it('can book a walk-in slot at an assigned venue', async () => {
    await staff
      .post('/owner/bookings')
      .send({
        resourceId: venueA.halfAId,
        durationMinutes: 60,
        customerWhatsappNumber: phoneB,
        startTime: futureStart(6, 11).toISOString(),
      })
      .expect(201);
  });

  it('can read the units of an assigned venue but not manage anything', async () => {
    await staff.get(`/resources?venueId=${venueA.venueId}`).expect(200);
    await staff.get(`/resources?venueId=${venueB.venueId}`).expect(403);
    await staff.patch(`/resources/${venueA.halfAId}`).send({ isBookable: false }).expect(403);
    await staff
      .post('/resources/pricing-rules')
      .send({ resourceId: venueA.halfAId, durationMinutes: 60, price: 1, currency: 'INR' })
      .expect(403);
    await staff.get(`/resources/pricing-rules?resourceId=${venueA.halfAId}`).expect(403);
    await staff.patch(`/venues/${venueA.venueId}`).send({ status: 'INACTIVE' }).expect(403);
    await staff.post('/venues').send({}).expect(403);
  });

  it('cannot reach payments, refunds, the revenue dashboard or staff admin', async () => {
    await staff.get('/owner/payments').expect(403);
    await staff.get('/owner/refunds').expect(403);
    await staff.get('/owner/dashboard/summary').expect(403);
    await staff.get('/owner/staff').expect(403);
    await staff.post('/owner/staff').send({}).expect(403);
  });

  it('/venues/mine and /auth/owner/me list only assigned venues', async () => {
    const mine = await staff.get('/venues/mine').expect(200);
    expect(mine.body.map((v: { id: string }) => v.id)).toEqual([venueA.venueId]);
    const me = await staff.get('/auth/owner/me').expect(200);
    expect(me.body.ownerRole).toBe('OWNER_STAFF');
    expect(me.body.venues.map((v: { id: string }) => v.id)).toEqual([venueA.venueId]);
    const adminMe = await owner.get('/auth/owner/me').expect(200);
    expect(adminMe.body.venues.length).toBeGreaterThanOrEqual(2);
  });

  describe('owner admin manages staff', () => {
    let invitedId: string;
    const email = `e2e-invite-${Date.now()}@example.com`;

    it('invites staff with venues (and rejects a venue outside the organization)', async () => {
      const otherOrg = await createOwnerFixture(app, admin);
      const foreign = await createVenueFixture(app, otherOrg.ownerAgent, admin);
      await owner
        .post('/owner/staff')
        .send({ email, name: 'E2E Invitee', venueIds: [foreign.venueId] })
        .expect(400);
      await owner.post('/owner/staff').send({ email, name: 'E2E Invitee', venueIds: [] }).expect(400);

      const res = await owner
        .post('/owner/staff')
        .send({ email, name: 'E2E Invitee', venueIds: [venueA.venueId, venueB.venueId] })
        .expect(201);
      invitedId = res.body.id;
      expect(res.body.venues.map((v: { id: string }) => v.id).sort()).toEqual(
        [venueA.venueId, venueB.venueId].sort(),
      );
      const row = await prisma.venueOwnerUser.findUniqueOrThrow({ where: { id: invitedId } });
      expect(row.role).toBe('OWNER_STAFF');
      expect(row.passwordHash).toBeNull();
    });

    it('lists staff, changes their venues at once, and disables them', async () => {
      const list = await owner.get('/owner/staff').expect(200);
      expect(list.body.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([staffId, invitedId]));

      // Reassigning applies immediately to the staff member's own access.
      await owner.patch(`/owner/staff/${staffId}/venues`).send({ venueIds: [venueB.venueId] }).expect(200);
      await staff.get(`/owner/bookings/${bookingA}`).expect(403);
      await staff.get(`/owner/bookings/${bookingB}`).expect(200);
      await owner.patch(`/owner/staff/${staffId}/venues`).send({ venueIds: [venueA.venueId] }).expect(200);

      const disabled = await owner.patch(`/owner/staff/${invitedId}/status`).send({ status: 'DISABLED' }).expect(200);
      expect(disabled.body.status).toBe('DISABLED');
      await owner.patch(`/owner/staff/${invitedId}/status`).send({ status: 'ACTIVE' }).expect(200);
    });

    it("cannot touch another organization's staff", async () => {
      const otherOrg = await createOwnerFixture(app, admin);
      await otherOrg.ownerAgent.patch(`/owner/staff/${staffId}/status`).send({ status: 'DISABLED' }).expect(404);
      await otherOrg.ownerAgent.patch(`/owner/staff/${staffId}/venues`).send({ venueIds: [venueA.venueId] }).expect(404);
    });
  });

  it('notifies only the staff assigned to the venue, plus owner admins', async () => {
    const { staffId: otherStaff } = await createStaffFixture(app, organizationId, [venueB.venueId]);
    await owner
      .post('/owner/bookings')
      .send({
        resourceId: venueA.halfBId,
        durationMinutes: 60,
        customerWhatsappNumber: phoneA,
        startTime: futureStart(8, 9).toISOString(),
      })
      .expect(201);
    // Fire-and-forget on the server; give it a moment. Staff of venue A is told, staff of B is not.
    await new Promise((r) => setTimeout(r, 500));
    const told = await prisma.ownerNotification.findMany({
      where: { ownerId: { in: [staffId, otherStaff] }, type: 'BOOKING_CONFIRMED' },
      select: { ownerId: true },
    });
    const ids = told.map((n) => n.ownerId);
    expect(ids).toContain(staffId);
    expect(ids).not.toContain(otherStaff);
  });
});
