import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { Role } from '@venue/shared';
import { agentForStaffContext, createOwnerFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** A venue owner signing themselves up: an organization and an owner login are made, and the owner is emailed a link to set a password. */
describe('Owner self-registration', () => {
  let app: INestApplication;
  let admin: TestAgent;
  const tag = uniqueSuffix().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const mail = (n: number) => `e2e-signup-${tag}-${n}@example.com`;
  const body = (n: number, extra: Record<string, unknown> = {}) => ({
    businessName: `E2E Sports ${tag} ${n}`,
    name: 'E2E Owner',
    email: mail(n),
    phone: '9847012345',
    acceptTerms: true,
    ...extra,
  });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => {
    await prisma.ownerOrganization.deleteMany({ where: { name: { startsWith: 'E2E Sports ' } } });
    await app.close();
  });

  it('creates the organization and a password-less owner admin, sends the invite, and records it', async () => {
    const res = await http().post('/auth/owner/register').send(body(1));
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    const user = await prisma.venueOwnerUser.findFirstOrThrow({ where: { email: mail(1) }, include: { organization: true } });
    expect(user).toMatchObject({ role: 'OWNER_ADMIN', status: 'ACTIVE', passwordHash: null, phone: '+919847012345' });
    expect(user.organization).toMatchObject({ name: `E2E Sports ${tag} 1`, contactEmail: mail(1), status: 'PENDING_APPROVAL' });
    // The owner can only get in through the emailed link: one invite token waits for them.
    expect(await prisma.staffAuthToken.count({ where: { userId: user.id, purpose: 'INVITE', usedAt: null } })).toBe(1);
    // Without a password they cannot sign in yet.
    expect((await http().post('/auth/owner/login').send({ email: mail(1), password: 'Anything12345!' })).status).toBe(401);
    // The Super Admin can see where it came from.
    expect(await prisma.auditLog.count({ where: { action: 'OWNER_SELF_REGISTERED', entityId: user.organizationId, actorType: 'SYSTEM' } })).toBe(1);
    // And the admin's owner list has it.
    const orgs = (await admin.get('/admin/organizations').expect(200)).body as Array<{ id: string }>;
    expect(orgs.some((o) => o.id === user.organizationId)).toBe(true);
  });

  /** A signed-in session for the owner a sign-up made (as if they had set their password through the emailed link). */
  async function signedInAs(n: number) {
    const user = await prisma.venueOwnerUser.findFirstOrThrow({ where: { email: mail(n) } });
    return {
      user,
      agent: await agentForStaffContext(app, { role: Role.VENUE_OWNER, id: user.id, organizationId: user.organizationId, ownerRole: 'OWNER_ADMIN' }),
    };
  }

  it('until the Super Admin approves, the owner sees only that they are waiting, and nothing else works', async () => {
    const { agent } = await signedInAs(1);
    const me = await agent.get('/auth/owner/me').expect(200);
    expect(me.body).toMatchObject({ organizationStatus: 'PENDING_APPROVAL', organizationName: `E2E Sports ${tag} 1`, venues: [] });
    for (const path of ['/owner/dashboard/summary', '/owner/payouts', '/owner/bookings', '/owner/notifications', '/owner/staff', '/owner/audit-log']) {
      const res = await agent.get(path);
      expect([path, res.status]).toEqual([path, 403]);
      expect([path, res.body.code]).toEqual([path, 'ORGANIZATION_PENDING']);
    }
    expect((await agent.post('/venues').send({ name: 'Sneaky venue' })).status).toBe(403);
    // The admin sees it waiting, and counts it.
    const orgs = (await admin.get('/admin/organizations').expect(200)).body as Array<{ id: string; status: string; name: string }>;
    expect(orgs.find((o) => o.name === `E2E Sports ${tag} 1`)?.status).toBe('PENDING_APPROVAL');
    expect((await admin.get('/admin/dashboard/summary').expect(200)).body.ownersPendingApproval).toBeGreaterThanOrEqual(1);
  });

  it('approving opens everything, is logged, and a refused sign-up is locked out', async () => {
    const { user, agent } = await signedInAs(1);
    expect((await admin.patch(`/admin/organizations/${user.organizationId}/status`).send({ status: 'ACTIVE' })).status).toBe(200);
    const me = await agent.get('/auth/owner/me').expect(200);
    expect(me.body.organizationStatus).toBe('ACTIVE');
    expect((await agent.get('/owner/dashboard/summary')).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'OWNER_ORGANIZATION_APPROVED', entityId: user.organizationId } })).toBe(1);

    // A second sign-up is refused instead: it can no longer do anything, not even look.
    await http().post('/auth/owner/register').send(body(5)).expect(202);
    const second = await signedInAs(5);
    await admin.patch(`/admin/organizations/${second.user.organizationId}/status`).send({ status: 'REJECTED' }).expect(200);
    expect((await second.agent.get('/auth/owner/me')).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'OWNER_ORGANIZATION_REJECTED', entityId: second.user.organizationId } })).toBe(1);
  });

  it('an organization the Super Admin created is active at once, and is not held for approval', async () => {
    const { ownerAgent } = await createOwnerFixture(app, admin);
    const me = await ownerAgent.get('/auth/owner/me').expect(200);
    expect(me.body.organizationStatus).toBe('ACTIVE');
    expect((await ownerAgent.get('/owner/dashboard/summary')).status).toBe(200);
  });

  it('answers the same when the email already has an account, and makes nothing new', async () => {
    const before = await prisma.ownerOrganization.count();
    const again = await http().post('/auth/owner/register').send(body(2, { email: mail(1).toUpperCase() }));
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ ok: true });
    const { ownerEmail } = await createOwnerFixture(app, admin);
    const existing = await http().post('/auth/owner/register').send(body(3, { email: ownerEmail }));
    expect(existing.status).toBe(202);
    expect(existing.body).toEqual({ ok: true });
    // Only the owner fixture made an organization; neither sign-up did.
    expect(await prisma.ownerOrganization.count()).toBe(before + 1);
    expect(await prisma.ownerOrganization.count({ where: { name: { in: [`E2E Sports ${tag} 2`, `E2E Sports ${tag} 3`] } } })).toBe(0);
  });

  it('refuses a request without accepting the terms, or with missing or bad details', async () => {
    for (const bad of [
      body(4, { acceptTerms: false }),
      { ...body(4), acceptTerms: undefined },
      body(4, { phone: '12345' }),
      body(4, { email: 'not-an-email' }),
      body(4, { businessName: 'A' }),
      body(4, { name: '' }),
    ]) {
      expect((await http().post('/auth/owner/register').send(bad)).status).toBe(400);
    }
    expect(await prisma.venueOwnerUser.count({ where: { email: mail(4) } })).toBe(0);
  });
});

describe('Owner self-registration limits', () => {
  it('is limited to a few sign-ups an hour from one address', async () => {
    const limitedApp = await createTestApp();
    const t = uniqueSuffix().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    try {
      let limited = 0;
      for (let n = 0; n < 8; n++) {
        const res = await request(limitedApp.getHttpServer()).post('/auth/owner/register').send({ businessName: `E2E Sports ${t} ${n}`, name: 'E2E Owner', email: `e2e-limit-${t}-${n}@example.com`, phone: '9847012345', acceptTerms: true });
        if (res.status === 429) limited += 1;
      }
      expect(limited).toBeGreaterThan(0);
    } finally {
      await prisma.ownerOrganization.deleteMany({ where: { name: { startsWith: `E2E Sports ${t}` } } });
      await limitedApp.close();
    }
  });
});
