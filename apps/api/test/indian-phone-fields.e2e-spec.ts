import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** Every phone number a person types in is a real Indian mobile number, stored as +91 and ten digits. */
describe('phone fields accept only Indian mobile numbers', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let organizationId: string;
  let venueId: string;
  const BAD = ['12345', '5876543210', '9999999999', '+14155550123', 'abc'];

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const fixture = await createOwnerFixture(app, admin);
    owner = fixture.ownerAgent;
    organizationId = fixture.organizationId;
    venueId = (await createVenueFixture(app, owner, admin)).venueId;
  });
  afterAll(async () => app.close());

  it('an organization contact phone', async () => {
    const make = (contactPhone: string) => {
      const s = uniqueSuffix();
      return admin.post('/admin/organizations').send({ name: `Phone Org ${s}`, contactEmail: `phone-org-${s}@example.com`, contactPhone });
    };
    for (const bad of BAD) expect((await make(bad)).status).toBe(400);
    const ok = await make('98765 43210');
    expect(ok.status).toBe(201);
    expect(ok.body.contactPhone).toBe('+919876543210');
  });

  it('an owner user invited by the admin, when a phone is given', async () => {
    const invite = (phone?: string) => {
      const s = uniqueSuffix();
      return admin.post(`/admin/organizations/${organizationId}/owner-users`).send({ email: `owner-${s}@example.com`, name: 'Phone Owner', ...(phone ? { phone } : {}) });
    };
    for (const bad of BAD) expect((await invite(bad)).status).toBe(400);
    expect((await invite()).status).toBe(201); // the phone is optional
    const ok = await invite('+91 98765 43211');
    expect(ok.status).toBe(201);
    const row = await prisma.venueOwnerUser.findFirstOrThrow({ where: { id: ok.body.id } });
    expect(row.phone).toBe('+919876543211');
  });

  it('a staff member invited by the owner, when a phone is given', async () => {
    const invite = (phone?: string) => {
      const s = uniqueSuffix();
      return owner.post('/owner/staff').send({ email: `staff-${s}@example.com`, name: 'Phone Staff', venueIds: [venueId], ...(phone ? { phone } : {}) });
    };
    for (const bad of BAD) expect((await invite(bad)).status).toBe(400);
    expect((await invite()).status).toBe(201);
    const ok = await invite('09876543212');
    expect(ok.status).toBe(201);
    expect((await prisma.venueOwnerUser.findFirstOrThrow({ where: { id: ok.body.id } })).phone).toBe('+919876543212');
  });
});
