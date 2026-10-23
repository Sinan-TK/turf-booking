import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  agentFor,
  createOwnerFixture,
  createStaffFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
} from './setup/fixtures';

/**
 * Owner-portal sign-in with Google (owner admins and owner staff; the Super Admin has no Google sign-in). Google
 * proves the email; the email must already be an invited, active owner-portal user. Nothing is ever created, and
 * an email that exists in another table (super admin, customer) opens nothing here.
 */
describe('Owner portal sign-in with Google', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

  const owner = (agent: ReturnType<typeof agentFor>, email: string, sub = `sub-${email}`, name = 'Some Owner') =>
    agent.post('/auth/owner/google').send({ credential: `test:${email}|${name}|${sub}` });

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => {
    await app.close();
  });

  test('an invited owner admin signs in, with their own organization and role, and the session works', async () => {
    const { organizationId, ownerEmail } = await createOwnerFixture(app, admin);
    const agent = agentFor(app);
    const res = await owner(agent, ownerEmail.toUpperCase(), `sub-${uniqueSuffix()}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'VENUE_OWNER', organizationId, ownerRole: 'OWNER_ADMIN' });
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toMatch(/owner_access=.*HttpOnly/);
    expect(cookies).toMatch(/owner_refresh=/);
    expect((await agent.get('/owner/dashboard/summary')).status).toBe(200);
    // It is bound to that Google account now.
    const row = await prisma.venueOwnerUser.findUniqueOrThrow({ where: { email: ownerEmail } });
    expect(row.googleSub).toMatch(/^sub-/);
  });

  test('an invited staff member signs in as staff: still limited to their venues and kept off the money pages', async () => {
    const { organizationId, ownerAgent } = await createOwnerFixture(app, admin);
    const venue = await createVenueFixture(app, ownerAgent, admin);
    const staff = await createStaffFixture(app, organizationId, [venue.venueId]);
    const row = await prisma.venueOwnerUser.findUniqueOrThrow({ where: { id: staff.staffId } });

    const agent = agentFor(app);
    const res = await owner(agent, row.email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ownerRole: 'OWNER_STAFF', organizationId });
    expect((await agent.get('/owner/bookings')).status).toBe(200);
    expect((await agent.get('/owner/payments')).status).toBe(403);
    expect((await agent.get('/owner/staff')).status).toBe(403);
  });

  test('an email that was never invited gets nothing, and no account is created anywhere', async () => {
    const email = `nobody-${uniqueSuffix()}@example.com`;
    const agent = agentFor(app);
    const res = await owner(agent, email);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toContain(email); // tells them which address to ask to have invited
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.venueOwnerUser.count({ where: { email } })).toBe(0);
    expect(await prisma.customerProfile.count({ where: { email } })).toBe(0);
    expect(await prisma.adminUser.count({ where: { email } })).toBe(0);
  });

  test('a Google account that is only a super admin, or only a customer, opens nothing in the owner portal', async () => {
    const adminEmail = `admin-${uniqueSuffix()}@example.com`;
    await prisma.adminUser.create({ data: { email: adminEmail, name: 'Only Admin', role: 'SUPER_ADMIN' } });
    expect((await owner(agentFor(app), adminEmail)).status).toBe(401);

    const customerEmail = `cust-${uniqueSuffix()}@example.com`;
    const customer = agentFor(app);
    expect((await customer.post('/customer-auth/google').send({ credential: `test:${customerEmail}|Only Customer` })).status).toBe(200);
    expect((await owner(agentFor(app), customerEmail)).status).toBe(401);
    // ...and the customer's own session is no owner session.
    expect((await customer.get('/owner/dashboard/summary')).status).toBe(403);
  });

  test('a disabled user, or a user of a suspended organization, is refused', async () => {
    const a = await createOwnerFixture(app, admin);
    await prisma.venueOwnerUser.update({ where: { email: a.ownerEmail }, data: { status: 'DISABLED' } });
    expect((await owner(agentFor(app), a.ownerEmail)).status).toBe(401);

    const b = await createOwnerFixture(app, admin);
    await prisma.ownerOrganization.update({ where: { id: b.organizationId }, data: { status: 'SUSPENDED' } });
    expect((await owner(agentFor(app), b.ownerEmail)).status).toBe(401);
  });

  test('the login is bound to the first Google account: another Google account with that email is refused', async () => {
    const { ownerEmail } = await createOwnerFixture(app, admin);
    const mine = `sub-mine-${uniqueSuffix()}`;
    expect((await owner(agentFor(app), ownerEmail, mine)).status).toBe(200);
    const intruder = await owner(agentFor(app), ownerEmail, `sub-other-${uniqueSuffix()}`);
    expect(intruder.status).toBe(401);
    expect(intruder.headers['set-cookie']).toBeUndefined();
    expect((await owner(agentFor(app), ownerEmail, mine)).status).toBe(200); // the owner still gets in
    expect((await prisma.venueOwnerUser.findUniqueOrThrow({ where: { email: ownerEmail } })).googleSub).toBe(mine);
  });

  test('one Google account cannot be bound to two owner logins', async () => {
    const a = await createOwnerFixture(app, admin);
    const b = await createOwnerFixture(app, admin);
    const shared = `sub-shared-${uniqueSuffix()}`;
    expect((await owner(agentFor(app), a.ownerEmail, shared)).status).toBe(200);
    expect((await owner(agentFor(app), b.ownerEmail, shared)).status).toBe(401);
  });

  test('garbage tokens are refused and the Super Admin portal has no Google sign-in at all', async () => {
    expect((await agentFor(app).post('/auth/owner/google').send({ credential: 'garbage' })).status).toBe(401);
    expect((await agentFor(app).post('/auth/owner/google').send({})).status).toBe(400);
    expect((await agentFor(app).post('/auth/admin/google').send({ credential: 'test:a@b.co' })).status).toBe(404);
    expect((await agentFor(app).post('/auth/nobody/google').send({ credential: 'test:a@b.co' })).status).toBe(404);
  });

  test('an owner session never reaches the Super Admin routes', async () => {
    const { ownerEmail } = await createOwnerFixture(app, admin);
    const agent = agentFor(app);
    expect((await owner(agent, ownerEmail)).status).toBe(200);
    for (const path of ['/admin/customers', '/admin/organizations', '/admin/payouts', '/admin/commercial-terms/default']) {
      expect((await agent.get(path)).status).toBe(403);
    }
  });

  describe('the same email in more than one table', () => {
    test('is three separate accounts: signing in as the owner gives nothing of the admin or the customer', async () => {
      const { ownerEmail, organizationId } = await createOwnerFixture(app, admin);
      // The same address also exists as a super admin and as a customer.
      const adminRow = await prisma.adminUser.create({ data: { email: ownerEmail, name: 'Same Email Admin', role: 'SUPER_ADMIN' } });
      const customerAgent = agentFor(app);
      const customer = await customerAgent.post('/customer-auth/google').send({ credential: `test:${ownerEmail}|Same Email Customer` });
      expect(customer.status).toBe(200);

      const ownerAgent = agentFor(app);
      const res = await owner(ownerAgent, ownerEmail);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'VENUE_OWNER', organizationId });
      expect(res.body.id).not.toBe(adminRow.id);
      expect(res.body.id).not.toBe(customer.body.customer.id);

      // The owner session is only an owner session...
      expect((await ownerAgent.get('/admin/customers')).status).toBe(403);
      expect((await ownerAgent.get('/customer-auth/me')).status).toBe(403);
      // ...and the customer's only a customer's.
      expect((await customerAgent.get('/owner/dashboard/summary')).status).toBe(403);
      expect((await customerAgent.get('/admin/customers')).status).toBe(403);
      // The admin row has no Google path and no password: the shared email logs nobody in as admin.
      const adminLogin = await agentFor(app).post('/auth/admin/login').send({ email: ownerEmail, password: 'anything-at-all' });
      expect(adminLogin.status).toBe(401);
      expect(await prisma.venueOwnerUser.count({ where: { email: ownerEmail } })).toBe(1);
      expect(await prisma.customerProfile.count({ where: { email: ownerEmail } })).toBe(1);
    });

    test('inside the owner portal one email is one user: it cannot also be invited as staff, or into another organization', async () => {
      const first = await createOwnerFixture(app, admin);
      const second = await createOwnerFixture(app, admin);
      const firstVenue = await createVenueFixture(app, first.ownerAgent, admin);
      const secondVenue = await createVenueFixture(app, second.ownerAgent, admin);
      const asStaff = await first.ownerAgent
        .post('/owner/staff')
        .send({ name: 'Same Person', email: first.ownerEmail.toUpperCase(), venueIds: [firstVenue.venueId] });
      expect(asStaff.status).toBe(409);
      const otherOrg = await second.ownerAgent
        .post('/owner/staff')
        .send({ name: 'Same Person', email: first.ownerEmail, venueIds: [secondVenue.venueId] });
      expect(otherOrg.status).toBe(409);
      expect(await prisma.venueOwnerUser.count({ where: { email: first.ownerEmail } })).toBe(1);
    });
  });
});
