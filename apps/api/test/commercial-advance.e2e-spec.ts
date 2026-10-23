import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCategoryFixture,
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

/**
 * The minimum online advance is a facility setting (minAdvancePercent of the full price). Owners can't save a
 * booking price below it, and a hold never charges less than it even when the facility's terms were raised
 * after the price was set. Every hold keeps a snapshot of the terms it was made under.
 */
describe('Minimum online advance', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let categoryId: string;
  let venueId: string;

  /** Changes some of a facility's own terms. (Reads first: a request must not be started while another runs.) */
  async function setTerms(id: string, patch: Record<string, unknown>) {
    const own = (await adminAgent.get(`/admin/categories/${id}/commercial-terms`)).body.own;
    const res = await adminAgent.put(`/admin/categories/${id}/commercial-terms`).send({ ...own, ...patch });
    expect(res.status).toBe(200);
  }

  async function newUnit() {
    const res = await ownerAgent
      .post('/resources')
      .send({ venueId, categoryId, name: `Court ${Math.random()}`, groundType: '', isBookable: true, sortOrder: 9 });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  function price(resourceId: string, body: Record<string, unknown>) {
    return ownerAgent
      .post('/resources/pricing-rules')
      .send({ resourceId, durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], currency: 'INR', ...body });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    categoryId = await createCategoryFixture(adminAgent);
    await setTerms(categoryId, { minAdvancePercent: 25 });
    ({ venueId } = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId }));
  });

  afterAll(async () => {
    await app.close();
  });

  test('a booking price below the facility minimum is refused, at or above it is accepted', async () => {
    const unit = await newUnit();
    const low = await price(unit, { normalPrice: 1000, bookingPrice: 249 });
    expect(low.status).toBe(400);
    expect(low.body.message).toMatch(/at least 25%/);
    expect((await price(unit, { normalPrice: 1000, bookingPrice: 250 })).status).toBe(201);
  });

  test('with an offer, the minimum is a share of the offer price', async () => {
    const unit = await newUnit();
    expect((await price(unit, { normalPrice: 1000, offerPrice: 800, bookingPrice: 199 })).status).toBe(400);
    expect((await price(unit, { normalPrice: 1000, offerPrice: 800, bookingPrice: 200 })).status).toBe(201);
  });

  test('editing a price is checked the same way', async () => {
    const unit = await newUnit();
    const created = await price(unit, { normalPrice: 1000, bookingPrice: 500 });
    const tooLow = await ownerAgent.patch(`/resources/pricing-rules/${created.body.id}`).send({ bookingPrice: 100 });
    expect(tooLow.status).toBe(400);
    const ok = await ownerAgent.patch(`/resources/pricing-rules/${created.body.id}`).send({ bookingPrice: 300 });
    expect(ok.status).toBe(200);
  });

  test('a hold charges at least the current minimum and snapshots the terms', async () => {
    const unit = await newUnit();
    expect((await price(unit, { normalPrice: 1000, bookingPrice: 250 })).status).toBe(201);
    // The facility raises its minimum after the price was set.
    await setTerms(categoryId, { minAdvancePercent: 50 });

    const { agent: customer } = await createCustomerFixture(app);
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: unit, startTime: futureStart(9, 10).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect(Number(hold.body.amount)).toBe(1000);
    expect(Number(hold.body.advanceAmount)).toBe(500);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect((booking.commercialTerms as { minAdvancePercent: number }).minAdvancePercent).toBe(50);

    // Later term changes don't touch an existing booking's snapshot.
    await setTerms(categoryId, { minAdvancePercent: 25 });
    const again = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect((again.commercialTerms as { minAdvancePercent: number }).minAdvancePercent).toBe(50);
  });

  test('pooled (per-unit) holds apply the minimum to the whole quantity', async () => {
    const pooledCategory = await createCategoryFixture(adminAgent, undefined, { allocationMode: 'POOLED' });
    await setTerms(pooledCategory, { minAdvancePercent: 40 });
    const group = await ownerAgent
      .post('/resources/groups')
      .send({ venueId, categoryId: pooledCategory, name: 'Kayaks', allocationMode: 'POOLED', totalUnits: 5, sortOrder: 0 });
    expect(group.status).toBe(201);
    const rule = await ownerAgent.post('/resources/pricing-rules').send({
      resourceGroupId: group.body.id,
      durationMinutes: 60,
      days: [1, 2, 3, 4, 5, 6, 7],
      pricingMode: 'PER_UNIT',
      normalPrice: 500,
      bookingPrice: 200,
      currency: 'INR',
    });
    expect(rule.status).toBe(201);
    // Below 40% is refused for groups too.
    const low = await ownerAgent.post('/resources/pricing-rules').send({
      resourceGroupId: group.body.id,
      durationMinutes: 120,
      days: [1],
      pricingMode: 'PER_UNIT',
      normalPrice: 500,
      bookingPrice: 100,
      currency: 'INR',
    });
    expect(low.status).toBe(400);

    await setTerms(pooledCategory, { minAdvancePercent: 60 });
    const { agent: customer } = await createCustomerFixture(app);
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceGroupId: group.body.id, quantity: 2, startTime: futureStart(9, 11).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect(Number(hold.body.amount)).toBe(1000);
    expect(Number(hold.body.advanceAmount)).toBe(600); // max(2 x 200, 60% of 1000)
  });
});
