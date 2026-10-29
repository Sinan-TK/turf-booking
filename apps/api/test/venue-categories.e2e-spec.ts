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

  async function districtOf() {
    const states = await request(app.getHttpServer()).get('/states');
    const districts = await request(app.getHttpServer()).get(`/districts?stateId=${states.body[0].id}`);
    return districts.body[0] as { id: string; timezone?: string };
  }

  /** A venue carries no facility of its own: they come from the units added to it. */
  async function createVenue() {
    // Resolve the district before building the request: supertest starts its
    // server when the request is created, and the lookups above would close it.
    const districtId = (await districtOf()).id;
    return ownerAgent.post('/venues').send({
      name: `E2E Venue ${uniqueSuffix()}`,
      districtId,
      address: '1 Test Lane',
      lat: 10,
      lng: 76,
    });
  }

  const addResource = (venueId: string, categoryId: string, groundType: string, name = 'Unit 1') =>
    ownerAgent.post('/resources').send({ venueId, categoryId, name, groundType });

  const addGroup = (venueId: string, categoryId: string, name: string, totalUnits = 5) =>
    ownerAgent.post('/resources/groups').send({
      venueId,
      categoryId,
      name,
      allocationMode: 'POOLED',
      totalUnits,
    });

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

  test('a venue is created without a facility or timezone; its timezone comes from its district', async () => {
    const district = await prisma.district.findUniqueOrThrow({ where: { id: (await districtOf()).id } });
    const res = await createVenue();
    expect(res.status).toBe(201);
    expect(res.body.facilities).toEqual([]);
    expect(res.body.timezone).toBe(district.timezone);
  });

  test('a venue lists the facilities of its units, and one venue can hold two', async () => {
    const { res: turf } = await createCategory({ unitTypes: ['Standard'] });
    const { res: pool } = await createCategory({ unitLabel: 'Lane' });
    const venue = await createVenue();
    expect((await addResource(venue.body.id, turf.body.id, 'Standard')).status).toBe(201);
    expect((await addResource(venue.body.id, pool.body.id, 'Lap', 'Lane 1')).status).toBe(201);
    expect((await addResource(venue.body.id, pool.body.id, 'Lap', 'Lane 2')).status).toBe(201);

    const got = await ownerAgent.get(`/venues/${venue.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.facilities.map((f: { id: string }) => f.id).sort()).toEqual([turf.body.id, pool.body.id].sort());
    expect(got.body.facilities.find((f: { id: string }) => f.id === pool.body.id).unitLabel).toBe('Lane');

    const units = await ownerAgent.get(`/resources?venueId=${venue.body.id}`);
    expect(units.body.find((r: { name: string }) => r.name === 'Lane 1').category.id).toBe(pool.body.id);
  });

  test('unit types follow the unit\'s facility (validated list vs free text)', async () => {
    const { res: listed } = await createCategory({ unitTypes: ['Standard', 'Blitz'] });
    const venue = await createVenue();
    expect((await addResource(venue.body.id, listed.body.id, 'Rapid', 'Board 1')).status).toBe(400);
    expect((await addResource(venue.body.id, listed.body.id, 'Standard', 'Board 1')).status).toBe(201);

    // Empty unitTypes => free text.
    const { res: free } = await createCategory({ unitTypes: [] });
    expect((await addResource(venue.body.id, free.body.id, 'Anything goes', 'Room A')).status).toBe(201);
  });

  test('exclusive facilities cannot host pooled inventory; pooled ones can', async () => {
    const { res: exclusive } = await createCategory();
    const { res: pooled } = await createCategory({ defaultAllocationMode: 'POOLED', unitLabel: 'Kayak' });
    const venue = await createVenue();
    expect((await addGroup(venue.body.id, exclusive.body.id, 'Pool')).status).toBe(400);
    expect((await addGroup(venue.body.id, pooled.body.id, 'Kayaks')).status).toBe(201);
  });

  test('a unit cannot be added under an unknown or inactive facility', async () => {
    const { res: facility } = await createCategory();
    const venue = await createVenue();
    await adminAgent.post(`/admin/categories/${facility.body.id}/deactivate`);
    expect((await addResource(venue.body.id, facility.body.id, 'x')).status).toBe(400);
    expect(
      (await addResource(venue.body.id, '00000000-0000-4000-8000-000000000000', 'x')).status,
    ).toBe(400);
    // categoryId is required now.
    expect((await ownerAgent.post('/resources').send({ venueId: venue.body.id, name: 'x', groundType: 'x' })).status).toBe(400);
  });

  test('composed resources must share a facility', async () => {
    const { res: a } = await createCategory();
    const { res: b } = await createCategory();
    const venue = await createVenue();
    const parent = await addResource(venue.body.id, a.body.id, 'x', 'Parent');
    const sameChild = await addResource(venue.body.id, a.body.id, 'x', 'Child A');
    const otherChild = await addResource(venue.body.id, b.body.id, 'x', 'Child B');
    const link = (child: string) =>
      ownerAgent.post('/resources/compositions').send({ parentResourceId: parent.body.id, childResourceId: child });
    expect((await link(otherChild.body.id)).status).toBe(400);
    expect((await link(sameChild.body.id)).status).toBe(201);
  });

  test('delete is refused once units exist; an unused facility can be deleted', async () => {
    const { res: used } = await createCategory();
    const venue = await createVenue();
    await addResource(venue.body.id, used.body.id, 'x');
    const refused = await adminAgent.delete(`/admin/categories/${used.body.id}`);
    expect(refused.status).toBe(409);

    const { res: unused } = await createCategory();
    const deleted = await adminAgent.delete(`/admin/categories/${unused.body.id}`);
    expect(deleted.status).toBe(200);
    expect((await adminAgent.get(`/admin/categories/${unused.body.id}`)).status).toBe(404);
  });

  test('?available=true lists only facilities with a bookable unit in an active venue', async () => {
    const { res: withUnit } = await createCategory();
    const { res: empty } = await createCategory();
    const venue = await createVenue();
    await addResource(venue.body.id, withUnit.body.id, 'x');

    const slugs = async (qs = '') =>
      (await request(app.getHttpServer()).get(`/categories${qs}`)).body.map((c: { slug: string }) => c.slug);
    // Still a DRAFT venue: nothing is bookable yet.
    expect(await slugs('?available=true')).not.toContain(withUnit.body.slug);
    expect(await slugs()).toContain(empty.body.slug);

    expect((await adminAgent.patch(`/venues/${venue.body.id}`).send({ status: 'ACTIVE' })).status).toBe(200);
    const available = await slugs('?available=true');
    expect(available).toContain(withUnit.body.slug);
    expect(available).not.toContain(empty.body.slug);
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

  it('gives each facility its own display order: the next free number by default, and a taken one is refused', async () => {
    const a = await createCategory();
    const b = await createCategory();
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);
    expect(b.res.body.sortOrder).toBeGreaterThan(a.res.body.sortOrder);

    // Asking for a number another facility has is a clear 409 that names it, on create and on update.
    const dupCreate = await createCategory({ sortOrder: a.res.body.sortOrder });
    expect(dupCreate.res.status).toBe(409);
    expect(dupCreate.res.body.message).toMatch(new RegExp(`Display order ${a.res.body.sortOrder} is already used by E2E`));
    expect(dupCreate.res.body.takenBy).toMatchObject({ id: a.res.body.id }); // who has it, so the admin can offer to switch places
    const dupUpdate = await adminAgent.patch(`/admin/categories/${b.res.body.id}`).send({ sortOrder: a.res.body.sortOrder });
    expect(dupUpdate.status).toBe(409);

    // Switching places trades the two numbers, and a facility can't switch with itself.
    const swapped = await adminAgent.post(`/admin/categories/${b.res.body.id}/swap-order`).send({ withId: a.res.body.id });
    expect(swapped.status).toBe(201);
    expect(swapped.body.sortOrder).toBe(a.res.body.sortOrder);
    const aAfter = await adminAgent.get(`/admin/categories/${a.res.body.id}`);
    expect(aAfter.body.sortOrder).toBe(b.res.body.sortOrder);
    await adminAgent.post(`/admin/categories/${b.res.body.id}/swap-order`).send({ withId: b.res.body.id }).expect(400);
    await adminAgent.post(`/admin/categories/${b.res.body.id}/swap-order`).send({ withId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await adminAgent.post(`/admin/categories/${b.res.body.id}/swap-order`).send({ withId: a.res.body.id }).expect(201); // back again

    // A free number is fine, and so is saving the same number again or changing something else.
    const free = 80_000 + Math.floor(Math.random() * 10_000);
    const moved = await adminAgent.patch(`/admin/categories/${b.res.body.id}`).send({ sortOrder: free });
    expect(moved.status).toBe(200);
    expect(moved.body.sortOrder).toBe(free);
    await adminAgent.patch(`/admin/categories/${b.res.body.id}`).send({ sortOrder: free }).expect(200);

    // Facilities that already share a number (older data) can still be saved for other reasons.
    await prisma.venueCategory.update({ where: { id: b.res.body.id }, data: { sortOrder: a.res.body.sortOrder } });
    const rename = await adminAgent.patch(`/admin/categories/${b.res.body.id}`).send({ unitLabel: 'Board' });
    expect(rename.status).toBe(200);

    for (const c of [a, b]) await adminAgent.post(`/admin/categories/${c.res.body.id}/deactivate`);
  });

  it('keeps a pasted SVG as the facility icon, refuses an unsafe one, and clears it again', async () => {
    const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/></svg>';
    const { res } = await createCategory({ iconSvg: svg });
    expect(res.status).toBe(201);
    expect(res.body.iconSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/></svg>');
    const id = res.body.id as string;

    // The public list (what the customer site draws) carries it too.
    const pub = await request(app.getHttpServer()).get('/categories');
    expect(pub.body.find((c: { id: string }) => c.id === id).iconSvg).toBe(res.body.iconSvg);

    // Unsafe markup is a clear 400 and the stored icon is untouched.
    const bad = await adminAgent.patch(`/admin/categories/${id}`).send({ iconSvg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/script/);
    expect((await adminAgent.get(`/admin/categories/${id}`)).body.iconSvg).toBe(res.body.iconSvg);
    expect((await createCategory({ iconSvg: '<svg viewBox="0 0 24 24"><path d="M0 0" onclick="x()"/></svg>' })).res.status).toBe(400);

    // Saving something else leaves it alone; null clears it, back to the icon name.
    const renamed = await adminAgent.patch(`/admin/categories/${id}`).send({ unitLabel: 'Board' });
    expect(renamed.body.iconSvg).toBe(res.body.iconSvg);
    const cleared = await adminAgent.patch(`/admin/categories/${id}`).send({ iconSvg: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.iconSvg).toBeNull();
    await adminAgent.post(`/admin/categories/${id}/deactivate`);
  });
});
