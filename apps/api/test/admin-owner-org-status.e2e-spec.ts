import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

describe('admin owner organization detail and suspension', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let organizationId: string;
  let ownerUserId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const fixture = await createOwnerFixture(app, admin);
    organizationId = fixture.organizationId;
    ownerUserId = (await prisma.venueOwnerUser.findUniqueOrThrow({ where: { email: fixture.ownerEmail } })).id;
  });
  afterAll(async () => app.close());

  const liveSessions = (userId: string) =>
    prisma.staffRefreshSession.count({ where: { portal: 'OWNER', userId, revokedAt: null } });
  const seedSession = (userId: string) =>
    prisma.staffRefreshSession.create({
      data: { portal: 'OWNER', userId, tokenHash: `t-${userId}-${Math.random()}`, expiresAt: new Date(Date.now() + 3_600_000) },
    });

  it('returns stats for an organization with no venues or bookings', async () => {
    const res = await admin.get(`/admin/organizations/${organizationId}`).expect(200);
    expect(res.body.stats).toMatchObject({
      venues: 0,
      totalBookings: 0,
      revenue: '0',
      lastBookedAt: null,
      logins: { total: 1, active: 1 },
    });
    expect(res.body.venues).toEqual([]);
  });

  it('suspending signs owners out and reactivating restores the status', async () => {
    await seedSession(ownerUserId);
    expect(await liveSessions(ownerUserId)).toBe(1);

    const suspended = await admin
      .patch(`/admin/organizations/${organizationId}/status`)
      .send({ status: 'SUSPENDED', reason: 'unpaid fees' })
      .expect(200);
    expect(suspended.body.status).toBe('SUSPENDED');
    expect(await liveSessions(ownerUserId)).toBe(0);

    const back = await admin.patch(`/admin/organizations/${organizationId}/status`).send({ status: 'ACTIVE' }).expect(200);
    expect(back.body.status).toBe('ACTIVE');
  });

  it('disables and re-enables one owner login without leaking the password hash', async () => {
    await seedSession(ownerUserId);
    const off = await admin
      .patch(`/admin/organizations/${organizationId}/owner-users/${ownerUserId}/status`)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect(off.body.status).toBe('DISABLED');
    expect(off.body).not.toHaveProperty('passwordHash');
    expect(await liveSessions(ownerUserId)).toBe(0);

    const on = await admin
      .patch(`/admin/organizations/${organizationId}/owner-users/${ownerUserId}/status`)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(on.body.status).toBe('ACTIVE');
  });

  it('rejects unknown statuses and logins from another organization', async () => {
    await admin.patch(`/admin/organizations/${organizationId}/status`).send({ status: 'GONE' }).expect(400);
    const other = await createOwnerFixture(app, admin);
    await admin
      .patch(`/admin/organizations/${other.organizationId}/owner-users/${ownerUserId}/status`)
      .send({ status: 'DISABLED' })
      .expect(404);
  });
});
