import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** The Super Admin's list of owner organizations carries who the owner is and how many venues are live. */
describe('Owner organizations list', () => {
  let app: INestApplication;
  let admin: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => app.close());

  const find = async (organizationId: string) => {
    const rows = (await admin.get('/admin/organizations').expect(200)).body as Array<{ id: string; ownerName: string | null; activeVenues: number }>;
    return rows.find((r) => r.id === organizationId);
  };

  it("shows the owner admin's name and counts only the venues that are active", async () => {
    const { organizationId, ownerAgent } = await createOwnerFixture(app, admin);
    const owner = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId } });
    expect(await find(organizationId)).toMatchObject({ ownerName: owner.name, activeVenues: 0 });

    await createVenueFixture(app, ownerAgent, admin);
    await createVenueFixture(app, ownerAgent, admin);
    const venues = await prisma.venue.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    expect(venues).toHaveLength(2);
    await prisma.venue.update({ where: { id: venues[0]!.id }, data: { status: 'ACTIVE' } });
    await prisma.venue.update({ where: { id: venues[1]!.id }, data: { status: 'DRAFT' } });
    expect((await find(organizationId))?.activeVenues).toBe(1);
    await prisma.venue.update({ where: { id: venues[0]!.id }, data: { status: 'SUSPENDED' } });
    expect((await find(organizationId))?.activeVenues).toBe(0);
  });

  it('an organization with no login yet has no owner name, and with several logins shows the owner admin, not staff', async () => {
    const created = await admin.post('/admin/organizations').send({ name: 'E2E Org No Login', contactEmail: 'e2e-nologin@example.com', contactPhone: '9847012345' }).expect(201);
    expect(await find(created.body.id)).toMatchObject({ ownerName: null, activeVenues: 0 });
    await prisma.venueOwnerUser.create({ data: { organizationId: created.body.id, email: `e2e-staff-first-${uniqueSuffix()}@example.com`, name: 'E2E Staff Person', role: 'OWNER_STAFF' } });
    expect((await find(created.body.id))?.ownerName).toBeNull(); // staff is not the owner
    await prisma.venueOwnerUser.create({ data: { organizationId: created.body.id, email: `e2e-admin-second-${uniqueSuffix()}@example.com`, name: 'E2E The Owner', role: 'OWNER_ADMIN' } });
    expect((await find(created.body.id))?.ownerName).toBe('E2E The Owner');
  });
});
