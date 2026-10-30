import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
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
import { SettlementsService } from '../src/settlements/settlements.service';

/**
 * "The customer did not come": the owner admin or the venue's staff mark a booking a no-show from the slot's start until a week after
 * it ends. Nothing is refunded and the money is settled exactly as for a played booking; only the label changes. It can be taken back.
 */
const TERMS = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: null,
  afterCapFeePercent: 0,
  minAdvancePercent: 25,
  cancellationTiers: [{ minHoursBeforeStart: 48, refundPercent: 100, ownerPercent: 0 }],
  cancelCutoffMinutes: 48 * 60,
};
const HOUR = 3_600_000;
const MIN = 60_000;

describe('Marking a booking as a no-show', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let staff: TestAgent; // assigned to the venue
  let otherStaff: TestAgent; // assigned to another venue of the same organisation
  let strangerOwner: TestAgent; // another organisation
  let customer: TestAgent;
  let settlements: SettlementsService;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let slot = 0;

  /** A booking paid online with coins (800: 80 commission, 720 to the owner), with its slot moved to `start`..`end`. */
  async function booking(start: Date, end: Date, resourceId = venue.halfAId) {
    const { agent, customerId } = await createCustomerFixture(app);
    customer = agent;
    await admin.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(20 + Math.floor(slot / 12), 8 + (slot % 12)).toISOString(), durationMinutes: 60 });
    slot++;
    expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    await prisma.booking.update({ where: { id: hold.body.id }, data: { startTime: start, endTime: end } });
    return hold.body.id as string;
  }
  const inProgress = () => booking(new Date(Date.now() - 30 * MIN), new Date(Date.now() + 30 * MIN));
  const ended = (hoursAgo = 3) => booking(new Date(Date.now() - hoursAgo * HOUR), new Date(Date.now() - (hoursAgo - 1) * HOUR));
  const status = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
  const settlement = (id: string) => prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId: id } });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const fx = await createOwnerFixture(app, admin);
    owner = fx.ownerAgent;
    const categoryId = await createCategoryFixture(admin, TERMS);
    venue = await createVenueFixture(app, owner, admin, { categoryId });
    const other = await createVenueFixture(app, owner, admin, { categoryId });
    ({ agent: staff } = await createStaffFixture(app, fx.organizationId, [venue.venueId]));
    ({ agent: otherStaff } = await createStaffFixture(app, fx.organizationId, [other.venueId]));
    strangerOwner = (await createOwnerFixture(app, admin)).ownerAgent;
    settlements = app.get(SettlementsService);
  });

  afterAll(async () => {
    await app.close();
  });

  test('only the owner admin and the venue\'s own staff can; everyone else is refused', async () => {
    const id = await inProgress();
    expect((await request(app.getHttpServer()).post(`/owner/bookings/${id}/no-show`)).status).toBe(401);
    expect((await customer.post(`/owner/bookings/${id}/no-show`)).status).toBe(403);
    expect((await admin.post(`/owner/bookings/${id}/no-show`)).status).toBe(403);
    expect((await strangerOwner.post(`/owner/bookings/${id}/no-show`)).status).toBe(403); // another organisation
    expect((await otherStaff.post(`/owner/bookings/${id}/no-show`)).status).toBe(403); // staff of another venue
    expect(await status(id)).toBe('CONFIRMED');

    expect((await staff.post(`/owner/bookings/${id}/no-show`)).status).toBe(201); // staff of this venue
    expect(await status(id)).toBe('NO_SHOW');
    expect((await owner.post(`/owner/bookings/${id}/no-show`)).status).toBe(400); // already marked
  });

  test('not before the slot starts, and not for a cancelled or unknown booking', async () => {
    const future = await booking(new Date(Date.now() + 2 * HOUR), new Date(Date.now() + 3 * HOUR));
    const early = await owner.post(`/owner/bookings/${future}/no-show`);
    expect(early.status).toBe(400);
    expect(early.body.message).toMatch(/hasn't started/);

    const cancelled = await booking(new Date(Date.now() + 5 * HOUR), new Date(Date.now() + 6 * HOUR));
    expect((await owner.post(`/owner/bookings/${cancelled}/cancel`).send({ reason: 'rain' })).status).toBe(201);
    const refused = await owner.post(`/owner/bookings/${cancelled}/no-show`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/cancelled booking can't/);
    expect((await owner.post('/owner/bookings/00000000-0000-4000-8000-000000000000/no-show')).status).toBe(404);
  });

  test('marked while the slot is on, it is settled as a no-show with the same money as a played booking', async () => {
    const played = await ended();
    const noShow = await inProgress();
    expect((await owner.post(`/owner/bookings/${noShow}/no-show`)).status).toBe(201);

    // Let the slot end (the booking's own times move into the past), then the automatic settling runs.
    await prisma.booking.update({ where: { id: noShow }, data: { startTime: new Date(Date.now() - 3 * HOUR), endTime: new Date(Date.now() - 2 * HOUR) } });
    await settlements.completeAndSettle(new Date());

    const a = await settlement(played);
    const b = await settlement(noShow);
    expect([a.kind, b.kind]).toEqual(['PLAYED', 'NO_SHOW']);
    expect(await status(noShow)).toBe('NO_SHOW'); // the automatic completion leaves it alone
    for (const key of ['collected', 'commission', 'fee', 'ownerAmount', 'platformAmount', 'refunded'] as const) {
      expect(Number(b[key])).toBe(Number(a[key]));
    }
    expect([Number(b.collected), Number(b.commission), Number(b.ownerAmount)]).toEqual([800, 80, 720]);
    // Nothing was refunded to the customer.
    expect(await prisma.refund.count({ where: { bookingId: noShow } })).toBe(0);
  });

  test('a played, already settled booking can be corrected to a no-show, and back: the statement line changes, not the money', async () => {
    const id = await ended();
    await settlements.completeAndSettle(new Date());
    const before = await settlement(id);
    expect([before.kind, await status(id)]).toEqual(['PLAYED', 'COMPLETED']);

    const marked = await staff.post(`/owner/bookings/${id}/no-show`);
    expect(marked.status).toBe(201);
    expect(marked.body.status).toBe('NO_SHOW');
    const after = await settlement(id);
    expect(after.kind).toBe('NO_SHOW');
    expect([Number(after.collected), Number(after.commission), Number(after.ownerAmount)]).toEqual([800, 80, 720]);
    expect(after.id).toBe(before.id); // the same statement line
    expect(after.payoutId).toBe(before.payoutId);

    // Taken back: the customer did come.
    const back = await owner.post(`/owner/bookings/${id}/played`);
    expect(back.status).toBe(201);
    expect(back.body.status).toBe('COMPLETED');
    expect((await settlement(id)).kind).toBe('PLAYED');
    expect((await owner.post(`/owner/bookings/${id}/played`)).status).toBe(400); // it is not a no-show now

    // Both changes are in the audit log, with who made them.
    const log = await prisma.auditLog.findMany({ where: { entityId: id, action: { in: ['BOOKING_NO_SHOW', 'BOOKING_MARKED_PLAYED'] } }, orderBy: { createdAt: 'asc' } });
    expect(log.map((l) => l.action)).toEqual(['BOOKING_NO_SHOW', 'BOOKING_MARKED_PLAYED']);
    expect(log[0]!.actorOwnerUserId).toBeTruthy();
  });

  test('only a week after the slot ends: later it is final', async () => {
    const old = await booking(new Date(Date.now() - 8 * 24 * HOUR), new Date(Date.now() - (8 * 24 - 1) * HOUR));
    const refused = await owner.post(`/owner/bookings/${old}/no-show`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/7 days/);
    const recent = await booking(new Date(Date.now() - 6 * 24 * HOUR), new Date(Date.now() - (6 * 24 - 1) * HOUR));
    expect((await owner.post(`/owner/bookings/${recent}/no-show`)).status).toBe(201);
    // And a no-show from long ago cannot be quietly turned back into "played" either.
    await prisma.booking.update({ where: { id: recent }, data: { startTime: new Date(Date.now() - 9 * 24 * HOUR), endTime: new Date(Date.now() - (9 * 24 - 1) * HOUR) } });
    expect((await owner.post(`/owner/bookings/${recent}/played`)).status).toBe(400);
  });

  test('a walk-in with nothing paid online can be a no-show too; there is no settlement to relabel', async () => {
    const start = DateTime.now().setZone('Asia/Kolkata').startOf('hour').minus({ hours: 3 });
    const walkIn = await owner.post('/owner/bookings').send({
      resourceId: venue.halfBId,
      durationMinutes: 60,
      customerWhatsappNumber: '+919100012345',
      customerName: 'E2E Walk-in',
      amount: 500,
      startTime: start.toUTC().toISO(),
    });
    expect(walkIn.status).toBe(201);
    const marked = await owner.post(`/owner/bookings/${walkIn.body.id}/no-show`);
    expect(marked.status).toBe(201);
    expect(marked.body.status).toBe('NO_SHOW');
    expect(await prisma.bookingSettlement.count({ where: { bookingId: walkIn.body.id } })).toBe(0);
  });

  test('the owner list and detail show it, and the status filter finds it', async () => {
    const id = await ended();
    await owner.post(`/owner/bookings/${id}/no-show`).expect(201);
    expect((await owner.get(`/owner/bookings/${id}`)).body.status).toBe('NO_SHOW');
    const list = await owner.get('/owner/bookings?status=NO_SHOW&limit=100');
    expect(list.body.some((b: { id: string }) => b.id === id)).toBe(true);
    expect(list.body.every((b: { status: string }) => b.status === 'NO_SHOW')).toBe(true);
  });
});
