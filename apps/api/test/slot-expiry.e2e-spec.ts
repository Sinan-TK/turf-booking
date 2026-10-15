import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
} from './setup/fixtures';
import { ExpiryService } from '../src/jobs/expiry.service';

/**
 * SlotHold expiry (ARCHITECTURE.md §8/§16) — a HELD-but-never-paid hold
 * must release its resource and cancel the booking once
 * `holdExpiresAt` passes. Rather than waiting real minutes for the cron
 * (`@Cron(CronExpression.EVERY_MINUTE)`) or faking Jest timers around a
 * scheduler Nest itself owns, this backdates `holdExpiresAt` directly
 * (the same kind of direct DB manipulation used throughout the
 * project's manual psql verification) and invokes
 * `ExpiryService.expireSlotHolds()` — the exact method the cron calls —
 * directly.
 */
describe('SlotHold expiry', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
  });

  afterAll(async () => {
    await app.close();
  });

  test('an expired hold releases the resource, its locks, and cancels the booking', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(8, 10).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect(hold.body.status).toBe('PENDING_PAYMENT');

    // Backdate the hold's own expiry (independent of the BookingSession
    // expiry — §8's explicit distinction) so the sweep picks it up.
    await prisma.slotHold.update({
      where: { id: hold.body.slotHoldId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    await app.get(ExpiryService).expireSlotHolds();

    const slotHold = await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.body.slotHoldId } });
    expect(slotHold.status).toBe('EXPIRED');

    const locks = await prisma.resourceLock.findMany({ where: { slotHoldId: hold.body.slotHoldId } });
    expect(locks.length).toBeGreaterThan(0);
    expect(locks.every((l) => l.status === 'EXPIRED')).toBe(true);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('CANCELLED');
    expect(booking.cancellationReasonCode).toBe('HOLD_EXPIRED');

    // The resource must be bookable again by someone else at the same time.
    const { agent: otherCustomer } = await createCustomerFixture(app);
    const rehold = await otherCustomer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(rehold.status).toBe(201);
  });

  test('re-running the sweep on an already-expired hold is a safe no-op', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(9, 10).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);

    await prisma.slotHold.update({
      where: { id: hold.body.slotHoldId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });

    await app.get(ExpiryService).expireSlotHolds();
    await expect(app.get(ExpiryService).expireSlotHolds()).resolves.not.toThrow();

    const slotHold = await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.body.slotHoldId } });
    expect(slotHold.status).toBe('EXPIRED');
  });
});
