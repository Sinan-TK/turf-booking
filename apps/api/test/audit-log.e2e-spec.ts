import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, loginAsSuperAdmin, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** The Super Admin's audit log: read only, filtered, paged, and showing who did what. */
describe('Admin audit log', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let slug: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    // An admin action that is audited: creating a facility, then renaming it.
    slug = `E2E_${uniqueSuffix().toUpperCase().replace(/-/g, '')}`;
    const created = await adminAgent.post('/admin/categories').send({ slug, name: `E2E Audit ${slug}`, iconKey: 'extension' });
    expect(created.status).toBe(201);
    categoryId = created.body.id;
    await adminAgent.patch(`/admin/categories/${categoryId}`).send({ unitLabel: 'Board' }).expect(200);
  });

  afterAll(async () => {
    await adminAgent.post(`/admin/categories/${categoryId}/deactivate`);
    await app.close();
  });

  test('only a Super Admin can read it', async () => {
    expect((await request(app.getHttpServer()).get('/admin/audit-logs')).status).toBe(401);
    expect((await ownerAgent.get('/admin/audit-logs')).status).toBe(403);
    expect((await ownerAgent.get('/admin/audit-logs/facets')).status).toBe(403);
  });

  test('shows the newest entries first, with who did it, and the total in a header', async () => {
    const res = await adminAgent.get('/admin/audit-logs?limit=5');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(Number(res.headers['x-total-count'])).toBeGreaterThanOrEqual(2);
    const times = res.body.map((r: { createdAt: string }) => new Date(r.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const mine = await adminAgent.get(`/admin/audit-logs?entityType=VenueCategory&search=${categoryId}`);
    expect(mine.body.map((r: { action: string }) => r.action).sort()).toEqual(['VENUE_CATEGORY_CREATED', 'VENUE_CATEGORY_UPDATED']);
    const entry = mine.body[0];
    expect(entry).toMatchObject({ actorType: 'ADMIN', entityId: categoryId });
    expect(entry.actor).toMatchObject({ email: expect.stringContaining('@') }); // a person, not just an id
  });

  test('filters by actor, action, kind of thing, search and date, and rejects bad values', async () => {
    const byAction = await adminAgent.get(`/admin/audit-logs?action=VENUE_CATEGORY_CREATED&search=${slug}`);
    expect(byAction.body).toHaveLength(0); // the slug is not in the entry; entityId is
    const byId = await adminAgent.get(`/admin/audit-logs?action=VENUE_CATEGORY_CREATED&search=${categoryId.slice(0, 13)}`);
    expect(byId.body).toHaveLength(1);

    const system = await adminAgent.get('/admin/audit-logs?actorType=SYSTEM&limit=3');
    expect(system.body.every((r: { actorType: string }) => r.actorType === 'SYSTEM')).toBe(true);

    const future = await adminAgent.get(`/admin/audit-logs?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
    expect(future.body).toHaveLength(0);
    const today = await adminAgent.get(`/admin/audit-logs?entityType=VenueCategory&from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`);
    expect(today.body.length).toBeGreaterThanOrEqual(2);

    expect((await adminAgent.get('/admin/audit-logs?actorType=ROBOT')).status).toBe(400);
    expect((await adminAgent.get('/admin/audit-logs?limit=abc')).status).toBe(400);
    expect((await adminAgent.get('/admin/audit-logs?from=not-a-date')).status).toBe(400);
  });

  test('pages through the log without repeating or missing entries', async () => {
    const all = await adminAgent.get('/admin/audit-logs?limit=6');
    const first = await adminAgent.get('/admin/audit-logs?limit=3&offset=0');
    const second = await adminAgent.get('/admin/audit-logs?limit=3&offset=3');
    expect([...first.body, ...second.body].map((r: { id: string }) => r.id)).toEqual(all.body.map((r: { id: string }) => r.id));
  });

  test('offers the kinds of thing and the actions it contains', async () => {
    const res = await adminAgent.get('/admin/audit-logs/facets');
    expect(res.status).toBe(200);
    expect(res.body.entityTypes).toContain('VenueCategory');
    expect(res.body.actions).toEqual(expect.arrayContaining(['VENUE_CATEGORY_CREATED', 'VENUE_CATEGORY_UPDATED']));
  });
});
