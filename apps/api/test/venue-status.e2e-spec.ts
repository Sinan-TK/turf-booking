import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

describe('who can set which venue status', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let venueId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    venueId = (await createVenueFixture(app, owner, admin)).venueId; // ends ACTIVE
  });
  afterAll(async () => app.close());

  it('an owner can pause their venue (INACTIVE) and make it live again (ACTIVE), but not set DRAFT or SUSPENDED', async () => {
    for (const status of ['DRAFT', 'SUSPENDED']) {
      await owner.patch(`/venues/${venueId}`).send({ status }).expect(403);
    }
    const paused = await owner.patch(`/venues/${venueId}`).send({ status: 'INACTIVE' }).expect(200);
    expect(paused.body.status).toBe('INACTIVE');
    const live = await owner.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' }).expect(200);
    expect(live.body.status).toBe('ACTIVE');
  });

  it('an owner cannot move a venue out of Draft or Suspended, which only the platform decides', async () => {
    for (const state of ['DRAFT', 'SUSPENDED']) {
      await admin.patch(`/venues/${venueId}`).send({ status: state }).expect(200);
      await owner.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' }).expect(403);
      await owner.patch(`/venues/${venueId}`).send({ status: 'INACTIVE' }).expect(403);
    }
    await admin.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' }).expect(200);
  });

  it('the Super Admin can set any status, including DRAFT and back to ACTIVE', async () => {
    for (const status of ['DRAFT', 'SUSPENDED', 'ACTIVE']) {
      const res = await admin.patch(`/venues/${venueId}`).send({ status }).expect(200);
      expect(res.body.status).toBe(status);
    }
  });
});
