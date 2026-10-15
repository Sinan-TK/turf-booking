import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import {
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
 * Venue categories (Phase 1): Super-Admin-only management, public listing of
 * active types, category-driven unit types, and the safety rules around
 * deactivating / deleting a type that venues or bookings depend on.
 * Every category this file creates has an E2E_ slug and is deactivated at
 * the end so it never shows up in the customer-facing list.
 */
describe('Venue categories', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;

  const policy = {
    slotIntervalMin: 30,
    minDurationMin: 30,
    maxDurationMin: 120,
    durationIncrementMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    maxAdvanceDays: 60,
    minLeadMinutes: 0,
  };

  async function createCategory(overrides: Record<string, unknown> = {}) {
    const slug = `E2E_${uniqueSuffix().toUpperCase().replace(/-/g, '')}`;
    const res = await adminAgent.post('/admin/categories').send({
      slug,
      name: `E2E ${slug}`,
      defaultAllocationMode: 'EXCLUSIVE',
      iconKey: 'extension',
      unitLabel: 'Table',
      venueLabel: 'Chess club',
      unitTypes: [],
      policy,
      ...overrides,
    });
    return { res, slug };
  }

  async function createVenue(categoryId?: string) {
    const states = await request(app.getHttpServer()).get('/states');
    const districts = await request(app.getHttpServer()).get(`/districts?stateId=${states.body[0].id}`);
    return ownerAgent.post('/venues').send({
      name: `E2E Venue ${uniqueSuffix()}`,
      districtId: districts.body[0].id,
      address: '1 Test Lane',
      lat: 10,
      lng: 76,
      timezone: 'Asia/Kolkata',
      ...(categoryId ? { categoryId } : {}),
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
  });

  afterAll(async () => {
    await prisma.venueCategory.updateMany({
      where: { slug: { startsWith: 'E2E_' } },
      data: { isActive: false },
    });
    await app.close();
  });

  test('only a Super Admin can manage categories', async () => {
    const body = { slug: 'E2E_NOPE', name: 'Nope', policy };
    expect((await request(app.getHttpServer()).post('/admin/categories').send(body)).status).toBe(401);
    expect((await ownerAgent.post('/admin/categories').send(body)).status).toBe(403);
    expect((await ownerAgent.get('/admin/categories')).status).toBe(403);
    const { res } = await createCategory();
    expect(res.status).toBe(201);
    expect((await ownerAgent.patch(`/admin/categories/${res.body.id}`).send({ name: 'x' })).status).toBe(403);
    expect((await ownerAgent.delete(`/admin/categories/${res.body.id}`)).status).toBe(403);
    expect((await ownerAgent.post(`/admin/categories/${res.body.id}/deactivate`)).status).toBe(403);
  });

  test('a Chess category is created with its own policy and listed publicly', async () => {
    const { res, slug } = await createCategory({ unitLabel: 'Board' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slug,
      defaultAllocationMode: 'EXCLUSIVE',
      iconKey: 'extension',
      unitLabel: 'Board',
      venueLabel: 'Chess club',
      isActive: true,
      venueCount: 0,
    });
    expect(res.body.policy).toMatchObject(policy);
    expect(res.body.policy.durations).toEqual([30, 60, 90, 120]);

    // Public (no auth): includes it, and football keeps today's rules.
    const list = await request(app.getHttpServer()).get('/categories');
    expect(list.status).toBe(200);
    const chess = list.body.find((c: { slug: string }) => c.slug === slug);
    expect(chess.policy.slotIntervalMin).toBe(30);
    const football = list.body.find((c: { slug: string }) => c.slug === 'FOOTBALL_TURF');
    expect(football.unitTypes).toEqual(['5S', '7S']);
    expect(football.policy).toMatchObject({
      slotIntervalMin: 60,
      minDurationMin: 60,
      maxDurationMin: 180,
      durationIncrementMin: 60,
    });
    expect(football.policy.durations).toEqual([60, 120, 180]);
  });

  test('invalid or duplicate categories are rejected', async () => {
    const { res, slug } = await createCategory();
    expect(res.status).toBe(201);
    const dup = await adminAgent.post('/admin/categories').send({ slug, name: 'Again', policy });
    expect(dup.status).toBe(409);

    const badSlug = await adminAgent.post('/admin/categories').send({ slug: 'chess club', name: 'x' });
    expect(badSlug.status).toBe(400);
    // 7 does not tile a day; max not reachable in whole increments; min > max.
    for (const bad of [
      { ...policy, slotIntervalMin: 7 },
      { ...policy, maxDurationMin: 100 },
      { ...policy, minDurationMin: 150 },
    ]) {
      const { res: r } = await createCategory({ policy: bad });
      expect(r.status).toBe(400);
    }
    const dupTypes = await createCategory({ unitTypes: ['Blitz', 'blitz'] });
    expect(dupTypes.res.status).toBe(400);
  });

  test('a venue with no category defaults to FOOTBALL_TURF; football behaviour is unchanged', async () => {
    const res = await createVenue();
    expect(res.status).toBe(201);
    expect(res.body.category.slug).toBe('FOOTBALL_TURF');
  });

  test('resource unit types follow the category (validated list vs free text)', async () => {
    const { res: listed } = await createCategory({ unitTypes: ['Standard', 'Blitz'] });
    const venue = await createVenue(listed.body.id);
    expect(venue.status).toBe(201);
    expect(venue.body.category.unitTypes).toEqual(['Standard', 'Blitz']);

    const resource = (groundType: string) =>
      ownerAgent.post('/resources').send({ venueId: venue.body.id, name: 'Board 1', groundType });
    expect((await resource('Rapid')).status).toBe(400);
    expect((await resource('Standard')).status).toBe(201);

    // Empty unitTypes => free text.
    const { res: free } = await createCategory({ unitTypes: [] });
    const freeVenue = await createVenue(free.body.id);
    const ok = await ownerAgent
      .post('/resources')
      .send({ venueId: freeVenue.body.id, name: 'Room A', groundType: 'Anything goes' });
    expect(ok.status).toBe(201);
  });

  test('exclusive venue types cannot host pooled inventory; pooled types can', async () => {
    const { res: exclusive } = await createCategory();
    const exclusiveVenue = await createVenue(exclusive.body.id);
    const rejected = await ownerAgent.post('/resources/groups').send({
      venueId: exclusiveVenue.body.id,
      name: 'Pool',
      allocationMode: 'POOLED',
      totalUnits: 5,
    });
    expect(rejected.status).toBe(400);

    const { res: pooled } = await createCategory({ defaultAllocationMode: 'POOLED', unitLabel: 'Kayak' });
    const pooledVenue = await createVenue(pooled.body.id);
    const accepted = await ownerAgent.post('/resources/groups').send({
      venueId: pooledVenue.body.id,
      name: 'Kayaks',
      allocationMode: 'POOLED',
      totalUnits: 5,
    });
    expect(accepted.status).toBe(201);
  });

  test('the venue type cannot change once resources exist, or to an inactive type', async () => {
    const { res: a } = await createCategory();
    const { res: b } = await createCategory();
    const venue = await createVenue(a.body.id);
    expect((await ownerAgent.patch(`/venues/${venue.body.id}`).send({ categoryId: b.body.id })).status).toBe(200);

    await ownerAgent.post('/resources').send({ venueId: venue.body.id, name: 'T1', groundType: 'x' });
    const blocked = await ownerAgent.patch(`/venues/${venue.body.id}`).send({ categoryId: a.body.id });
    expect(blocked.status).toBe(409);

    await adminAgent.post(`/admin/categories/${a.body.id}/deactivate`);
    const fresh = await createVenue(a.body.id);
    expect(fresh.status).toBe(400);
  });

  test('delete is refused once venues exist; an unused type can be deleted', async () => {
    const { res: used } = await createCategory();
    await createVenue(used.body.id);
    const refused = await adminAgent.delete(`/admin/categories/${used.body.id}`);
    expect(refused.status).toBe(409);

    const { res: unused } = await createCategory();
    const deleted = await adminAgent.delete(`/admin/categories/${unused.body.id}`);
    expect(deleted.status).toBe(200);
    expect((await adminAgent.get(`/admin/categories/${unused.body.id}`)).status).toBe(404);
  });

  test('deactivation is blocked while live bookings exist, and hides the type once safe', async () => {
    const { res: category, slug } = await createCategory();
    const fixture = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId: category.body.id });
    const { agent: customer } = await createCustomerFixture(app);

    const hold = await customer.post('/bookings/hold').send({
      resourceId: fixture.halfAId,
      startTime: futureStart(3, 10).toISOString(),
      durationMinutes: 60,
    });
    expect(hold.status).toBe(201);

    const refused = await adminAgent.post(`/admin/categories/${category.body.id}/deactivate`);
    expect(refused.status).toBe(409);
    const stillPublic = await request(app.getHttpServer()).get('/categories');
    expect(stillPublic.body.some((c: { slug: string }) => c.slug === slug)).toBe(true);

    // Once the booking is cancelled, deactivation succeeds and hides the type.
    const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(cancel.status).toBeLessThan(300);
    const ok = await adminAgent.post(`/admin/categories/${category.body.id}/deactivate`);
    expect(ok.status).toBe(201);
    expect(ok.body.isActive).toBe(false);
    const hidden = await request(app.getHttpServer()).get('/categories');
    expect(hidden.body.some((c: { slug: string }) => c.slug === slug)).toBe(false);

    const reactivated = await adminAgent.post(`/admin/categories/${category.body.id}/activate`);
    expect(reactivated.body.isActive).toBe(true);
  });
});
