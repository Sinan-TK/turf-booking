import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { agentFor, createCustomerFixture, createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/**
 * What the Super Admin controls about the public site: the Google sign-in switch (off means it neither shows nor works), and the
 * venues the landing page features, in the admin's order.
 */
describe('Site settings: Google sign-in switch and featured venues', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let venues: Array<Awaited<ReturnType<typeof createVenueFixture>>>;

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    venues = [await createVenueFixture(app, owner, admin), await createVenueFixture(app, owner, admin), await createVenueFixture(app, owner, admin)];
  });
  afterAll(async () => {
    await prisma.venue.updateMany({ where: { featuredOrder: { not: null } }, data: { featuredOrder: null } });
    await app.close();
  });

  const token = () => `test:g-${uniqueSuffix()}@example.com|Ria Menon|sub-${uniqueSuffix()}`;
  const publicGet = (path: string) => request(app.getHttpServer()).get(path);

  describe('Google sign-in', () => {
    test('while it is off the site says so and a Google sign-in is refused; turned on again it works', async () => {
      expect((await admin.put('/admin/site/google').send({ enabled: false })).body).toEqual({ googleSignIn: false });
      expect((await publicGet('/site/config')).body).toEqual({ googleSignIn: false });
      const refused = await agentFor(app).post('/customer-auth/google').send({ credential: token() });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/not available/i);

      expect((await admin.put('/admin/site/google').send({ enabled: true })).body).toEqual({ googleSignIn: true });
      expect((await publicGet('/site/config')).body).toEqual({ googleSignIn: true });
      expect((await agentFor(app).post('/customer-auth/google').send({ credential: token() })).status).toBe(200);
    });

    test('with no setting saved at all it is off', async () => {
      await prisma.platformSetting.deleteMany({ where: { key: 'googleSignIn' } });
      expect((await publicGet('/site/config')).body).toEqual({ googleSignIn: false });
      expect((await agentFor(app).post('/customer-auth/google').send({ credential: token() })).status).toBe(403);
      await admin.put('/admin/site/google').send({ enabled: true });
    });

    test('every change is in the audit log, and only the Super Admin can make one', async () => {
      await admin.put('/admin/site/google').send({ enabled: false });
      expect(await prisma.auditLog.count({ where: { action: 'SITE_GOOGLE_SIGNIN_DISABLED' } })).toBeGreaterThan(0);
      await admin.put('/admin/site/google').send({ enabled: true });
      expect(await prisma.auditLog.count({ where: { action: 'SITE_GOOGLE_SIGNIN_ENABLED' } })).toBeGreaterThan(0);
      expect((await admin.put('/admin/site/google').send({ enabled: 'yes' })).status).toBe(400);
      expect((await owner.put('/admin/site/google').send({ enabled: false })).status).toBe(403);
      const { agent: customer } = await createCustomerFixture(app);
      expect((await customer.put('/admin/site/google').send({ enabled: false })).status).toBe(403);
      expect((await request(app.getHttpServer()).put('/admin/site/google').send({ enabled: false })).status).toBe(401);
      expect((await publicGet('/site/config')).body.googleSignIn).toBe(true);
    });
  });

  describe('featured venues', () => {
    const names = async () => ((await publicGet('/site/featured-venues')).body as Array<{ name: string }>).map((v) => v.name);
    const nameOf = async (i: number) => (await prisma.venue.findUniqueOrThrow({ where: { id: venues[i]!.venueId } })).name;

    test('nothing is featured to begin with', async () => {
      await admin.put('/admin/site/featured').send({ venueIds: [] }).expect(200);
      expect((await publicGet('/site/featured-venues')).body).toEqual([]);
    });

    test('the admin picks venues and their order; the landing page lists them in that order, only while they are live', async () => {
      const [a, b, c] = venues.map((v) => v.venueId) as [string, string, string];
      const view = await admin.put('/admin/site/featured').send({ venueIds: [c, a, b] }).expect(200);
      expect(view.body.featured.map((v: { id: string }) => v.id)).toEqual([c, a, b]);
      expect(await names()).toEqual([await nameOf(2), await nameOf(0), await nameOf(1)]);

      const first = (await publicGet('/site/featured-venues')).body[0];
      expect(first).toMatchObject({ id: c, facilityCode: expect.any(String), address: expect.any(String) });
      expect(first.facilities.length).toBeGreaterThan(0);
      // The pictures (the card turns through them) and the icon of its kind of facility (shown while there are none).
      expect(Array.isArray(first.photoUrls)).toBe(true);
      expect(first.icon).toMatchObject({ iconKey: expect.any(String) });

      // A different order, and one taken off.
      await admin.put('/admin/site/featured').send({ venueIds: [b, c] }).expect(200);
      expect(await names()).toEqual([await nameOf(1), await nameOf(2)]);
      expect((await admin.get('/admin/site').expect(200)).body.featured.map((v: { id: string }) => v.id)).toEqual([b, c]);

      // A venue that is no longer live is not shown to customers, though the admin still sees it in the list.
      await prisma.venue.update({ where: { id: b }, data: { status: 'INACTIVE' } });
      expect(await names()).toEqual([await nameOf(2)]);
      expect((await admin.get('/admin/site').expect(200)).body.featured).toHaveLength(2);
      await prisma.venue.update({ where: { id: b }, data: { status: 'ACTIVE' } });
    });

    test('repeats are ignored, an unknown venue or too many venues are refused, and nothing changes when it is refused', async () => {
      const [a, b] = venues.map((v) => v.venueId) as [string, string];
      await admin.put('/admin/site/featured').send({ venueIds: [a, a, b] }).expect(200);
      expect((await admin.get('/admin/site')).body.featured).toHaveLength(2);
      expect((await admin.put('/admin/site/featured').send({ venueIds: [a, '00000000-0000-4000-8000-000000000000'] })).status).toBe(400);
      expect((await admin.put('/admin/site/featured').send({ venueIds: ['nope'] })).status).toBe(400);
      expect((await admin.get('/admin/site')).body.featured.map((v: { id: string }) => v.id)).toEqual([a, b]);
      const tooMany = Array.from({ length: 13 }, () => a);
      expect((await admin.put('/admin/site/featured').send({ venueIds: tooMany })).status).toBe(200); // repeats collapse to one
      const many = await Promise.all(Array.from({ length: 13 }, async (_, i) => (await prisma.venue.findMany({ take: 13, orderBy: { id: 'asc' } }))[i]?.id));
      const real = many.filter((x): x is string => !!x);
      if (real.length === 13) expect((await admin.put('/admin/site/featured').send({ venueIds: real })).status).toBe(400);
    });

    test('only the Super Admin changes it; anyone can read the public list', async () => {
      expect((await owner.put('/admin/site/featured').send({ venueIds: [] })).status).toBe(403);
      expect((await owner.get('/admin/site')).status).toBe(403);
      expect((await request(app.getHttpServer()).put('/admin/site/featured').send({ venueIds: [] })).status).toBe(401);
      expect((await publicGet('/site/featured-venues')).status).toBe(200);
    });
  });
});
