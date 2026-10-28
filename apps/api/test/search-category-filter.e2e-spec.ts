import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';

/** The customer can narrow the search to one venue type or several at once (categorySlugs, comma-separated). */
describe('search by several venue types', () => {
  let app: INestApplication;
  const tag = uniqueSuffix();
  const TEXT = `Types ${tag}`;
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const slugs: string[] = [];

  const search = (extra: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .get('/search')
      .query({ date, timeWindow: 'ALL', durationMinutes: 60, lat: 10, lng: 76, radiusKm: 5, q: TEXT, ...extra });
  const venueNames = (body: Array<{ venue: { name: string } }>) => [...new Set(body.map((r) => r.venue.name))].sort();

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    const owner = (await createOwnerFixture(app, admin)).ownerAgent;
    // Three venues: one of each of two new venue types, and one football turf.
    const categoryIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const slug = `E2E_${uniqueSuffix().toUpperCase().replace(/-/g, '')}`;
      const res = await admin.post('/admin/categories').send({
        slug,
        name: `E2E ${slug}`,
        defaultAllocationMode: 'EXCLUSIVE',
        iconKey: 'extension',
        unitLabel: 'Table',
        venueLabel: 'Club',
        unitTypes: [],
        policy: {
          slotIntervalMin: 30,
          minDurationMin: 30,
          maxDurationMin: 120,
          durationIncrementMin: 30,
          bufferBeforeMin: 0,
          bufferAfterMin: 0,
          maxAdvanceDays: 60,
          minLeadMinutes: 0,
        },
      });
      expect(res.status).toBe(201);
      slugs.push(slug);
      categoryIds.push(res.body.id);
    }
    const venues = [
      (await createVenueFixture(app, owner, admin, { categoryId: categoryIds[0] })).venueId,
      (await createVenueFixture(app, owner, admin, { categoryId: categoryIds[1] })).venueId,
      (await createVenueFixture(app, owner, admin)).venueId,
    ];
    for (const [i, id] of venues.entries()) await prisma.venue.update({ where: { id }, data: { name: `${TEXT} ${'ABC'[i]}` } });
  });

  afterAll(async () => {
    await prisma.venueCategory.updateMany({ where: { slug: { in: slugs } }, data: { isActive: false } });
    await app.close();
  });

  it('with no type every venue matches', async () => {
    expect(venueNames((await search().expect(200)).body)).toEqual([`${TEXT} A`, `${TEXT} B`, `${TEXT} C`]);
  });

  it('several types keep the venues of any of them', async () => {
    const res = await search({ categorySlugs: `${slugs[0]},${slugs[1]}` }).expect(200);
    expect(venueNames(res.body)).toEqual([`${TEXT} A`, `${TEXT} B`]);
    expect(res.body).toHaveLength(6);
  });

  it('one type in the list works like categorySlug, and the two combine', async () => {
    expect(venueNames((await search({ categorySlugs: slugs[0]! }).expect(200)).body)).toEqual([`${TEXT} A`]);
    expect(venueNames((await search({ categorySlug: slugs[1]! }).expect(200)).body)).toEqual([`${TEXT} B`]);
    const both = await search({ categorySlug: 'FOOTBALL_TURF', categorySlugs: slugs[0]! }).expect(200);
    expect(venueNames(both.body)).toEqual([`${TEXT} A`, `${TEXT} C`]);
  });

  it('unknown types are ignored, and only unknown types match nothing', async () => {
    expect(venueNames((await search({ categorySlugs: `NO_SUCH_TYPE,${slugs[1]}` }).expect(200)).body)).toEqual([`${TEXT} B`]);
    expect((await search({ categorySlugs: 'NO_SUCH_TYPE' }).expect(200)).body).toEqual([]);
  });
});
