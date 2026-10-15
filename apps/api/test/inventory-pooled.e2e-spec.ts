import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
  type TestAgent,
} from './setup/fixtures';
import { ExpiryService } from '../src/jobs/expiry.service';

/**
 * P2 pooled quantity inventory (kayak fleets): SINGLE/DOUBLE
 * ResourceGroups with totalUnits, PER_UNIT pricing, and the row-lock +
 * counted-sum race guard. Exclusive-path behavior is covered by the
 * pre-existing suites; this file proves the pooled path and that the
 * two never interfere.
 */
describe('Pooled inventory (kayak fleets)', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let venueId: string;
  let singleId: string;
  let doubleId: string;

  async function createGroup(name: string, allocationMode: string, totalUnits?: number) {
    const res = await ownerAgent.post('/resources/groups').send({
      venueId,
      name,
      allocationMode,
      ...(totalUnits === undefined ? {} : { totalUnits }),
      sortOrder: 0,
    });
    if (res.status !== 201) {
      throw new Error(`Group creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.id as string;
  }

  async function priceGroup(resourceGroupId: string, price: number) {
    for (const dayType of ['WEEKDAY', 'WEEKEND']) {
      const res = await ownerAgent.post('/resources/pricing-rules').send({
        resourceGroupId,
        durationMinutes: 60,
        dayType,
        pricingMode: 'PER_UNIT',
        price,
        currency: 'INR',
      });
      if (res.status !== 201) {
        throw new Error(`Group pricing failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    const fixture = await createOwnerFixture(app, adminAgent);
    ownerAgent = fixture.ownerAgent;

    const statesRes = await request(app.getHttpServer()).get('/states');
    const stateId = statesRes.body[0]?.id;
    const districtsRes = await request(app.getHttpServer()).get(`/districts?stateId=${stateId}`);
    const districtId = districtsRes.body[0]?.id;

    // Pooled inventory belongs to a POOLED venue type (kayaking); exclusive
    // types such as the football default reject pooled groups.
    const kayakCategory = await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'KAYAKING' } });

    const suffix = uniqueSuffix();
    const venueRes = await ownerAgent.post('/venues').send({
      categoryId: kayakCategory.id,
      name: `E2E Kayak Base ${suffix}`,
      districtId,
      address: '2 Lake Road',
      lat: 10,
      lng: 76,
      timezone: 'Asia/Kolkata',
      defaultSlotGranularityMinutes: 30,
    });
    if (venueRes.status !== 201) {
      throw new Error(`Venue creation failed: ${venueRes.status} ${JSON.stringify(venueRes.body)}`);
    }
    venueId = venueRes.body.id as string;
    const activateRes = await adminAgent.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' });
    if (activateRes.status !== 200) {
      throw new Error(
        `Venue activation failed: ${activateRes.status} ${JSON.stringify(activateRes.body)}`,
      );
    }

    singleId = await createGroup('Single Kayaks', 'POOLED', 10);
    doubleId = await createGroup('Double Kayaks', 'POOLED', 4);
    await priceGroup(singleId, 500);
    await priceGroup(doubleId, 900);

    for (let weekday = 0; weekday <= 6; weekday++) {
      const res = await ownerAgent
        .put('/venue-config/operating-hours')
        .send({ venueId, weekday, openTime: '00:00', closeTime: '23:59' });
      if (res.status !== 200) {
        throw new Error(`Operating hours upsert failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  test('request validation rejects bad pooled holds', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(11, 10).toISOString();

    // Both ids.
    const both = await customer
      .post('/bookings/hold')
      .send({ resourceId: singleId, resourceGroupId: singleId, startTime, durationMinutes: 60 });
    expect(both.status).toBe(400);

    // quantity 0.
    const zero = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 0, startTime, durationMinutes: 60 });
    expect(zero.status).toBe(400);

    // quantity above totalUnits.
    const over = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 11, startTime, durationMinutes: 60 });
    expect(over.status).toBe(400);

    // EXCLUSIVE group through the pooled path.
    const exclusiveId = await createGroup('Whole Lake Hire', 'EXCLUSIVE');
    const excl = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: exclusiveId, quantity: 1, startTime, durationMinutes: 60 });
    expect(excl.status).toBe(400);

    // Group with no pricing configured.
    const unpricedId = await createGroup('Unpriced Fleet', 'POOLED', 5);
    const unpriced = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: unpricedId, quantity: 1, startTime, durationMinutes: 60 });
    expect(unpriced.status).toBe(400);
  });

  test('quantity hold prices per unit and tracks remaining capacity', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(12, 10).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 3, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect(hold.body.status).toBe('PENDING_PAYMENT');
    expect(hold.body.quantity).toBe(3);
    expect(hold.body.resourceGroupId).toBe(singleId);
    expect(hold.body.resourceId).toBeNull();
    // PER_UNIT 500 x 3 = 1500, snapshotted at hold time.
    expect(Number(hold.body.amount)).toBe(1500);

    const snapshot = hold.body.slotHoldId
      ? await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.body.slotHoldId } })
      : null;
    expect(snapshot).not.toBeNull();
    expect((snapshot!.priceSnapshot as { quantity: number }).quantity).toBe(3);

    const preview = await customer.get(
      `/bookings/group-availability?resourceGroupId=${singleId}&startTime=${encodeURIComponent(startTime)}&durationMinutes=60&quantity=1`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.available).toBe(true);
    expect(preview.body.remaining).toBe(7);
    expect(Number(preview.body.price.amount)).toBe(500);

    // Over remaining capacity.
    const tooMany = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 8, startTime, durationMinutes: 60 });
    expect(tooMany.status).toBe(409);
  });

  test('concurrent holds never oversell the pool', async () => {
    const startTime = futureStart(13, 10).toISOString();
    // Fresh slot: full 10 units available.
    const customers = await Promise.all(
      Array.from({ length: 5 }, () => createCustomerFixture(app)),
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        customers[i % customers.length].agent
          .post('/bookings/hold')
          .send({ resourceGroupId: singleId, quantity: 1, startTime, durationMinutes: 60 }),
      ),
    );
    const created = attempts.filter(
      (a): a is PromiseFulfilledResult<request.Response> =>
        a.status === 'fulfilled' && a.value.status === 201,
    );
    const conflicts = attempts.filter(
      (a) =>
        a.status === 'fulfilled' &&
        (a.value.status === 409 || a.value.status === 400 || a.value.status === 500),
    );
    expect(created).toHaveLength(10);
    expect(conflicts).toHaveLength(10);
    expect(
      conflicts.every(
        (a) => a.status === 'fulfilled' && (a.value as request.Response).status === 409,
      ),
    ).toBe(true);

    // Database-level proof: held quantity for the slot is exactly 10.
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(quantity), 0)::bigint AS total
      FROM inventory_reservations
      WHERE "resourceGroupId" = ${singleId}::uuid
        AND status IN ('HELD', 'CONFIRMED')
        AND "startTime" < ${new Date(new Date(startTime).getTime() + 60 * 60 * 1000)}
        AND "endTime" > ${new Date(startTime)}
    `;
    expect(Number(rows[0]?.total ?? 0)).toBe(10);
  });

  test('cancelling a pooled hold releases its units', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(14, 10).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: doubleId, quantity: 4, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);

    const full = await customer.get(
      `/bookings/group-availability?resourceGroupId=${doubleId}&startTime=${encodeURIComponent(startTime)}&durationMinutes=60&quantity=1`,
    );
    expect(full.body).toMatchObject({ available: false });

    const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(cancel.status).toBe(201);

    const reservations = await prisma.inventoryReservation.findMany({
      where: { slotHoldId: hold.body.slotHoldId },
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe('RELEASED');

    const freed = await customer.get(
      `/bookings/group-availability?resourceGroupId=${doubleId}&startTime=${encodeURIComponent(startTime)}&durationMinutes=60&quantity=4`,
    );
    expect(freed.body).toMatchObject({ available: true, remaining: 4 });
  });

  test('coin payment confirms the reservation; paid cancel refunds and releases', async () => {
    const { agent: customer, customerId } = await createCustomerFixture(app);
    const topUp = await adminAgent
      .post('/admin/coins/adjust')
      .send({ customerId, signedAmount: 10000, reason: 'E2E pooled top-up' });
    expect(topUp.status).toBe(201);

    const startTime = futureStart(15, 10).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: doubleId, quantity: 2, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect(Number(hold.body.amount)).toBe(1800);

    const pay = await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(201);

    const confirmed = await prisma.inventoryReservation.findMany({
      where: { slotHoldId: hold.body.slotHoldId },
    });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].status).toBe('CONFIRMED');

    const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(cancel.status).toBe(201);
    expect(cancel.body.refund?.status).toBe('COMPLETED');

    const released = await prisma.inventoryReservation.findMany({
      where: { slotHoldId: hold.body.slotHoldId },
    });
    expect(released[0].status).toBe('RELEASED');
  });

  test('expiry frees pooled units without touching other slots', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(16, 10).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 5, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);

    await prisma.slotHold.update({
      where: { id: hold.body.slotHoldId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await app.get(ExpiryService).expireSlotHolds();

    const expired = await prisma.inventoryReservation.findMany({
      where: { slotHoldId: hold.body.slotHoldId },
    });
    expect(expired).toHaveLength(1);
    expect(expired[0].status).toBe('EXPIRED');

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('CANCELLED');

    // Units are bookable again at the same time.
    const { agent: other } = await createCustomerFixture(app);
    const rehold = await other
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 5, startTime, durationMinutes: 60 });
    expect(rehold.status).toBe(201);
  });

  test('venue-wide blackout blocks pooled holds; resource-scoped blocks do not', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(17, 10).toISOString();

    const block = await ownerAgent.post('/venue-config/blocked-dates').send({
      venueId,
      startTime,
      endTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
      reason: 'Lake closed',
    });
    expect(block.status).toBe(201);

    const blocked = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 1, startTime, durationMinutes: 60 });
    expect(blocked.status).toBe(409);

    await ownerAgent.delete(`/venue-config/blocked-dates/${block.body.id}`);

    // A resource-scoped block on another inventory kind never applies to
    // the pool (BlockedDate has no group column until the P3 cutover).
    const res = await ownerAgent.post('/resources').send({
      venueId,
      name: 'Jetty',
      groundType: 'DOCK',
      isBookable: true,
      sortOrder: 0,
    });
    expect(res.status).toBe(201);
    const scoped = await ownerAgent.post('/venue-config/blocked-dates').send({
      venueId,
      resourceId: res.body.id,
      startTime,
      endTime: new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
      reason: 'Jetty maintenance',
    });
    expect(scoped.status).toBe(201);

    const allowed = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: singleId, quantity: 1, startTime, durationMinutes: 60 });
    expect(allowed.status).toBe(201);
  });
});
