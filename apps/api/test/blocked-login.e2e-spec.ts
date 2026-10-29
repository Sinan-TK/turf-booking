import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createStaffFixture, createVenueFixture, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

/**
 * A login that is blocked stops working at once, even though the access token it already holds has minutes left to live:
 * the guard checks the account on every request, not only when the token is issued.
 */
describe('Blocked logins stop working immediately', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let organizationId: string;
  let staff: TestAgent;
  let staffId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const fx = await createOwnerFixture(app, admin);
    owner = fx.ownerAgent;
    organizationId = fx.organizationId;
    const venue = await createVenueFixture(app, owner, admin);
    ({ agent: staff, staffId } = await createStaffFixture(app, organizationId, [venue.venueId]));
  });

  afterAll(async () => {
    await app.close();
  });

  test('a staff member the owner blocks is refused straight away, and works again once enabled', async () => {
    await staff.get('/owner/bookings').expect(200);

    await owner.patch(`/owner/staff/${staffId}/status`).send({ status: 'DISABLED' }).expect(200);
    const refused = await staff.get('/owner/bookings');
    expect(refused.status).toBe(401);
    expect(refused.body.message).toMatch(/no longer active/);
    await staff.get('/auth/owner/me').expect(401);

    await owner.patch(`/owner/staff/${staffId}/status`).send({ status: 'ACTIVE' }).expect(200);
    await staff.get('/owner/bookings').expect(200); // the same token, now that the login is active again
  });

  test('a staff member whose role changes must sign in again', async () => {
    await staff.get('/owner/bookings').expect(200);
    await prisma.venueOwnerUser.update({ where: { id: staffId }, data: { role: 'OWNER_ADMIN' } });
    await staff.get('/owner/bookings').expect(401); // the token still says staff
    await prisma.venueOwnerUser.update({ where: { id: staffId }, data: { role: 'OWNER_STAFF' } });
    await staff.get('/owner/bookings').expect(200);
  });

  test('suspending the organisation stops its owner and staff, and reinstating brings them back', async () => {
    await owner.get('/owner/bookings').expect(200);
    await admin.patch(`/admin/organizations/${organizationId}/status`).send({ status: 'SUSPENDED', reason: 'test' }).expect(200);
    await owner.get('/owner/bookings').expect(401);
    await staff.get('/owner/bookings').expect(401);
    await admin.patch(`/admin/organizations/${organizationId}/status`).send({ status: 'ACTIVE' }).expect(200);
    await owner.get('/owner/bookings').expect(200);
  });

  test('the owner can delete a staff login for good; nobody else can, and no owner admin can be deleted this way', async () => {
    const other = await createOwnerFixture(app, admin);
    const target = await createStaffFixture(app, organizationId, []);
    await target.agent.get('/owner/bookings').expect(200);

    await other.ownerAgent.delete(`/owner/staff/${target.staffId}`).expect(404); // another organisation's owner cannot see it
    await staff.delete(`/owner/staff/${target.staffId}`).expect(403); // staff cannot delete anyone
    const ownerAdmin = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId, role: 'OWNER_ADMIN' } });
    await owner.delete(`/owner/staff/${ownerAdmin.id}`).expect(404); // the staff route only reaches staff

    await owner.delete(`/owner/staff/${target.staffId}`).expect(200);
    await target.agent.get('/owner/bookings').expect(401); // signed out at once
    expect(await prisma.venueOwnerUser.findUnique({ where: { id: target.staffId } })).toBeNull();
    expect(await prisma.staffRefreshSession.count({ where: { userId: target.staffId } })).toBe(0);
    const entry = await prisma.auditLog.findFirst({ where: { action: 'OWNER_STAFF_DELETED', entityId: target.staffId } });
    expect(entry).toBeTruthy(); // the deletion itself is kept in the audit log
    await owner.delete(`/owner/staff/${target.staffId}`).expect(404); // already gone
  });

  test('a removed login cannot act at all', async () => {
    const extra = await createStaffFixture(app, organizationId, []);
    await extra.agent.get('/owner/bookings').expect(200);
    await prisma.venueOwnerUser.delete({ where: { id: extra.staffId } });
    await extra.agent.get('/owner/bookings').expect(401);
  });
});
