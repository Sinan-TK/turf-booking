import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createStaffFixture, createVenueFixture, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

type Entry = {
  id: string;
  actorType: string;
  actor: { email: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  ipAddress?: unknown;
};

/** An owner's own audit log: their people's actions and what was done to their things, never another organisation's. */
describe('Owner audit log', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let a: { organizationId: string; ownerAgent: TestAgent; ownerEmail: string; venueId: string };
  let b: { organizationId: string; ownerAgent: TestAgent; ownerEmail: string; venueId: string };
  let staffAgent: TestAgent;

  async function org() {
    const fixture = await createOwnerFixture(app, adminAgent);
    const { venueId } = await createVenueFixture(app, fixture.ownerAgent, adminAgent);
    return { ...fixture, venueId };
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    a = await org();
    b = await org();
    ({ agent: staffAgent } = await createStaffFixture(app, a.organizationId, [a.venueId]));
  });

  afterAll(async () => {
    await app.close();
  });

  test('only the owner admin can read it', async () => {
    expect((await request(app.getHttpServer()).get('/owner/audit-log')).status).toBe(401);
    expect((await staffAgent.get('/owner/audit-log')).status).toBe(403);
    expect((await staffAgent.get('/owner/audit-log/facets')).status).toBe(403);
    expect((await adminAgent.get('/owner/audit-log')).status).toBe(403); // the Super Admin has their own log
    expect((await a.ownerAgent.get('/owner/audit-log')).status).toBe(200);
  });

  test('shows what the owner did and what the platform did to their venue, and nothing of another organisation', async () => {
    const res = await a.ownerAgent.get('/owner/audit-log?limit=100');
    const rows = res.body as Entry[];
    expect(Number(res.headers['x-total-count'])).toBe(rows.length);

    const created = rows.find((r) => r.action === 'VENUE_CREATED' && r.entityId === a.venueId)!;
    expect(created).toBeTruthy();
    expect(created.actorType).toBe('OWNER');
    expect(created.actor).toMatchObject({ email: a.ownerEmail }); // their own person is named

    // The Super Admin activated the venue: shown as the platform, with no name, no recorded details and no IP.
    const activated = rows.find((r) => r.action === 'VENUE_UPDATED' && r.entityId === a.venueId && r.actorType === 'ADMIN')!;
    expect(activated).toBeTruthy();
    expect(activated.actor).toBeNull();
    expect(activated.metadata).toBeNull();
    expect(activated).not.toHaveProperty('ipAddress');

    // Nothing about the other organisation's venue, its people or itself.
    expect(rows.some((r) => r.entityId === b.venueId)).toBe(false);
    expect(rows.some((r) => r.entityId === b.organizationId)).toBe(false);
    expect(rows.some((r) => r.actor?.email === b.ownerEmail)).toBe(false);
    const theirs = (await b.ownerAgent.get('/owner/audit-log?limit=100')).body as Entry[];
    expect(theirs.some((r) => r.entityId === a.venueId)).toBe(false);
    expect(theirs.some((r) => r.entityId === b.venueId)).toBe(true);

    // The log's own kinds only: no slot holds, coin wallets or customers.
    const facets = (await a.ownerAgent.get('/owner/audit-log/facets')).body as { entityTypes: string[]; actions: string[] };
    expect(facets.entityTypes).toContain('Venue');
    expect(facets.entityTypes).not.toEqual(expect.arrayContaining(['CoinWallet']));
    expect(facets.actions).toEqual(expect.arrayContaining(['VENUE_CREATED', 'VENUE_UPDATED']));
  });

  test('filters by who, kind, action, search and date, pages, and refuses bad values', async () => {
    const admin = (await a.ownerAgent.get('/owner/audit-log?actorType=ADMIN&limit=100')).body as Entry[];
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((r) => r.actorType === 'ADMIN')).toBe(true);

    const owner = (await a.ownerAgent.get(`/owner/audit-log?actorType=OWNER&search=${encodeURIComponent(a.ownerEmail)}`)).body as Entry[];
    expect(owner.length).toBeGreaterThan(0);
    expect(owner.every((r) => r.actor?.email === a.ownerEmail)).toBe(true);

    const byVenue = (await a.ownerAgent.get(`/owner/audit-log?entityType=Venue&action=VENUE_CREATED&search=${a.venueId.slice(0, 13)}`)).body as Entry[];
    expect(byVenue).toHaveLength(1);
    expect((await a.ownerAgent.get(`/owner/audit-log?search=${b.venueId.slice(0, 13)}`)).body).toHaveLength(0); // their venue id finds nothing
    expect((await a.ownerAgent.get(`/owner/audit-log?search=${encodeURIComponent('%')}`)).body).toHaveLength(0); // "%" is text, not a wildcard

    const future = await a.ownerAgent.get(`/owner/audit-log?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
    expect(future.body).toHaveLength(0);

    const all = (await a.ownerAgent.get('/owner/audit-log?limit=4')).body as Entry[];
    const p1 = (await a.ownerAgent.get('/owner/audit-log?limit=2&offset=0')).body as Entry[];
    const p2 = (await a.ownerAgent.get('/owner/audit-log?limit=2&offset=2')).body as Entry[];
    expect([...p1, ...p2].map((r) => r.id)).toEqual(all.map((r) => r.id));

    expect((await a.ownerAgent.get('/owner/audit-log?actorType=ROBOT')).status).toBe(400);
    expect((await a.ownerAgent.get('/owner/audit-log?limit=x')).status).toBe(400);
    expect((await a.ownerAgent.get('/owner/audit-log?from=nope')).status).toBe(400);
  });
});
