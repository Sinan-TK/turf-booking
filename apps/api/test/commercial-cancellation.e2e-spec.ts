import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCategoryFixture,
  createCustomerFixture,
  createOwnerFixture,
  createStaffFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

/**
 * Cancellation follows the facility's terms, as they were when the booking was made: a full coin refund early,
 * a split (coins / owner / platform) in the late window, and no customer cancellation inside the cut-off.
 * Owners and admins can always cancel, refunding everything as coins. Windows here are in days so the tests
 * don't depend on the time of day they run at.
 */
const TERMS = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: null,
  afterCapFeePercent: 0,
  minAdvancePercent: 25,
  cancellationTiers: [
    { minHoursBeforeStart: 240, refundPercent: 100, ownerPercent: 0 }, // 10+ days before
    { minHoursBeforeStart: 48, refundPercent: 30, ownerPercent: 50 }, // 2-10 days before
  ],
  cancelCutoffMinutes: 48 * 60, // closed in the last 2 days
};

describe('Cancellation windows, cut-off and staff cancellation', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let organizationId: string;
  let categoryId: string;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let hour = 6;

  /** A coin-paid booking `days` ahead (each on its own hour so they never clash). Full price = advance = 800. */
  async function paidBooking(days: number, resourceId = venue.halfAId) {
    const { agent, customerId } = await createCustomerFixture(app);
    await adminAgent.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(days, hour++).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    const pay = await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(201);
    return { agent, customerId, bookingId: hold.body.id as string };
  }

  async function balance(customerId: string) {
    return Number((await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } })).cachedBalance);
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent, organizationId } = await createOwnerFixture(app, adminAgent));
    categoryId = await createCategoryFixture(adminAgent, TERMS);
    venue = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId });
  });

  afterAll(async () => {
    await app.close();
  });

  test('early cancellation: everything back as coins, nothing to settle', async () => {
    const { agent, customerId, bookingId } = await paidBooking(14);
    const before = await balance(customerId);
    const res = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(res.status).toBe(201);
    expect(Number(res.body.refund.coinAmountCredited)).toBe(800);
    expect((await balance(customerId)) - before).toBe(800);
    expect(await prisma.bookingSettlement.findUnique({ where: { bookingId } })).toBeNull();
  });

  test('late cancellation: coins, owner and platform shares, recorded as a settlement', async () => {
    const { agent, customerId, bookingId } = await paidBooking(5);
    const before = await balance(customerId);
    const res = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(res.status).toBe(201);
    expect(Number(res.body.refund.coinAmountCredited)).toBe(240);
    expect((await balance(customerId)) - before).toBe(240);

    const s = await prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId } });
    expect(s.kind).toBe('LATE_CANCEL');
    expect(s.organizationId).toBe(organizationId);
    expect(s.categoryId).toBe(categoryId);
    expect(Number(s.collected)).toBe(800);
    expect(Number(s.refunded)).toBe(240);
    expect(Number(s.ownerAmount)).toBe(400);
    expect(Number(s.platformAmount)).toBe(160);
    expect(s.payoutId).toBeNull();
  });

  test('inside the cut-off a customer cannot cancel, and the preview says so', async () => {
    const { agent, bookingId } = await paidBooking(1);
    const preview = await agent.get(`/me/bookings/${bookingId}/cancellation`);
    expect(preview.status).toBe(200);
    expect(preview.body.canCancel).toBe(false);

    const res = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANCELLATION_CLOSED');
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('the preview shows the windows as times and what cancelling now returns', async () => {
    const { agent, bookingId } = await paidBooking(5);
    const preview = await agent.get(`/me/bookings/${bookingId}/cancellation`);
    expect(preview.status).toBe(200);
    expect(preview.body.canCancel).toBe(true);
    expect(preview.body.paidOnline).toBe('800.00');
    expect(preview.body.now).toEqual({ refundPercent: 30, refundCoins: '240.00' });
    expect(preview.body.windows.map((w: { refundPercent: number }) => w.refundPercent)).toEqual([100, 30]);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(new Date(preview.body.closesAt).getTime()).toBe(booking.startTime.getTime() - 48 * 3_600_000);
  });

  test('a booking keeps the terms it was made under', async () => {
    const { agent, bookingId } = await paidBooking(14);
    // The facility tightens its windows afterwards: 14 days out would now be "late".
    const res0 = await adminAgent.put(`/admin/categories/${categoryId}/commercial-terms`).send({
      ...TERMS,
      cancellationTiers: [
        { minHoursBeforeStart: 1000, refundPercent: 100, ownerPercent: 0 },
        { minHoursBeforeStart: 48, refundPercent: 10, ownerPercent: 50 },
      ],
    });
    expect(res0.status).toBe(200);
    const res = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(Number(res.body.refund.coinAmountCredited)).toBe(800);
    await adminAgent.put(`/admin/categories/${categoryId}/commercial-terms`).send(TERMS);
  });

  test('an unpaid booking can be dropped any time, with no refund', async () => {
    const { agent } = await createCustomerFixture(app);
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime: futureStart(1, hour++).toISOString(), durationMinutes: 60 });
    const res = await agent.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(res.status).toBe(201);
    expect(res.body.refund).toBeNull();
  });

  test('the owner can cancel even inside the cut-off: full coin refund, no owner share', async () => {
    const { customerId, bookingId } = await paidBooking(1);
    const before = await balance(customerId);
    const res = await ownerAgent.post(`/owner/bookings/${bookingId}/cancel`).send({ reason: 'Rain' });
    expect(res.status).toBe(201);
    expect((await balance(customerId)) - before).toBe(800);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('CANCELLED');
    expect(booking.cancellationReasonCode).toBe('OWNER_ACTION');
    expect(booking.cancellationNote).toBe('Rain');
    expect(await prisma.bookingSettlement.findUnique({ where: { bookingId } })).toBeNull();
  });

  test('staff of another venue cannot cancel; staff of this venue can', async () => {
    const other = await createStaffFixture(app, organizationId, []);
    const { bookingId } = await paidBooking(1);
    expect((await other.agent.post(`/owner/bookings/${bookingId}/cancel`).send({})).status).toBe(403);
    const assigned = await createStaffFixture(app, organizationId, [venue.venueId]);
    expect((await assigned.agent.post(`/owner/bookings/${bookingId}/cancel`).send({})).status).toBe(201);
  });

  test('another organization cannot cancel; the admin can', async () => {
    const { ownerAgent: stranger } = await createOwnerFixture(app, adminAgent);
    const { bookingId } = await paidBooking(1);
    expect((await stranger.post(`/owner/bookings/${bookingId}/cancel`).send({})).status).toBe(403);
    const res = await adminAgent.post(`/admin/bookings/${bookingId}/cancel`).send({ reason: 'Venue closed' });
    expect(res.status).toBe(201);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.cancellationReasonCode).toBe('ADMIN_ACTION');
  });

  test('a cancelled booking cannot be cancelled again', async () => {
    const { agent, bookingId } = await paidBooking(14);
    expect((await agent.post(`/me/bookings/${bookingId}/cancel`).send({})).status).toBe(201);
    expect((await agent.post(`/me/bookings/${bookingId}/cancel`).send({})).status).toBe(400);
    expect((await ownerAgent.post(`/owner/bookings/${bookingId}/cancel`).send({})).status).toBe(400);
  });

  test('bookings made before commercial terms existed cancel on the current terms, without a settlement', async () => {
    const { agent, customerId, bookingId } = await paidBooking(5);
    await prisma.booking.update({ where: { id: bookingId }, data: { commercialTerms: undefined } });
    await prisma.$executeRaw`UPDATE bookings SET "commercialTerms" = NULL WHERE id = ${bookingId}::uuid`;
    const before = await balance(customerId);
    const res = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(res.status).toBe(201);
    expect((await balance(customerId)) - before).toBe(240);
    expect(await prisma.bookingSettlement.findUnique({ where: { bookingId } })).toBeNull();
  });

  test('a venue deal can switch customer cancellation off and on; staff can still cancel', async () => {
    const { agent, customerId, bookingId } = await paidBooking(14);
    const deal = (cancellationEnabled: boolean) =>
      adminAgent.put(`/admin/venues/${venue.venueId}/facilities/${categoryId}/commercial-terms`).send({ cancellationEnabled });

    expect((await deal(false)).status).toBe(200);
    const preview = await agent.get(`/me/bookings/${bookingId}/cancellation`);
    expect(preview.body.cancellationEnabled).toBe(false);
    expect(preview.body.canCancel).toBe(false);
    const blocked = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.code).toBe('CANCELLATION_CLOSED');
    expect(blocked.body.message).toMatch(/does not allow/);

    // Turned back on: the windows apply again, even for a booking made while it was off.
    expect((await deal(true)).status).toBe(200);
    const before = await balance(customerId);
    const ok = await agent.post(`/me/bookings/${bookingId}/cancel`).send({});
    expect(ok.status).toBe(201);
    expect((await balance(customerId)) - before).toBe(800);
    await adminAgent.delete(`/admin/venues/${venue.venueId}/facilities/${categoryId}/commercial-terms`);
  });
});
