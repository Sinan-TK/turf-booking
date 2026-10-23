import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCategoryFixture,
  createOwnerFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

/**
 * Commercial terms are owned by the facility (VenueCategory), pre-filled from the platform default, and can be
 * overridden for one venue's facility field by field. Only the Super Admin edits them; owners can read theirs.
 */
describe('Commercial terms: platform default, facility and venue deal', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let categoryId: string;
  let venueId: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    categoryId = await createCategoryFixture(adminAgent);
    ({ venueId } = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId }));
  });

  afterAll(async () => {
    await app.close();
  });

  test('the platform default is complete and readable by the admin', async () => {
    const res = await adminAgent.get('/admin/commercial-terms/default');
    expect(res.status).toBe(200);
    for (const key of ['commissionTiers', 'monthlyCommissionCap', 'minAdvancePercent', 'cancellationTiers', 'payoutWeekday']) {
      expect(res.body.terms).toHaveProperty(key);
    }
  });

  test('a new facility starts with its own copy of the default facility terms', async () => {
    const def = (await adminAgent.get('/admin/commercial-terms/default')).body.terms;
    const res = await adminAgent.get(`/admin/categories/${categoryId}/commercial-terms`);
    expect(res.status).toBe(200);
    expect(res.body.own.minAdvancePercent).toBe(def.minAdvancePercent);
    expect(res.body.own.commissionTiers).toEqual(def.commissionTiers);
    expect(res.body.own).not.toHaveProperty('payoutWeekday');
    expect(res.body.sources.minAdvancePercent).toBe('FACILITY');
    expect(res.body.sources.payoutWeekday).toBe('PLATFORM_DEFAULT');
  });

  test('editing a facility changes only that facility; the default is untouched', async () => {
    const before = (await adminAgent.get(`/admin/categories/${categoryId}/commercial-terms`)).body.own;
    const put = await adminAgent
      .put(`/admin/categories/${categoryId}/commercial-terms`)
      .send({ ...before, minAdvancePercent: 40, monthlyCommissionCap: null });
    expect(put.status).toBe(200);
    expect(put.body.terms.minAdvancePercent).toBe(40);
    expect(put.body.terms.monthlyCommissionCap).toBeNull();

    const def = (await adminAgent.get('/admin/commercial-terms/default')).body.terms;
    expect(def.monthlyCommissionCap).not.toBeNull();
  });

  test('a facility key removed from its own terms inherits from the platform default', async () => {
    const before = (await adminAgent.get(`/admin/categories/${categoryId}/commercial-terms`)).body.own;
    const { afterCapFeePercent: _removed, ...rest } = before;
    const put = await adminAgent.put(`/admin/categories/${categoryId}/commercial-terms`).send(rest);
    expect(put.status).toBe(200);
    expect(put.body.sources.afterCapFeePercent).toBe('PLATFORM_DEFAULT');
  });

  test('invalid terms are rejected with a reason', async () => {
    const own = (await adminAgent.get(`/admin/categories/${categoryId}/commercial-terms`)).body.own;
    const tooHigh = await adminAgent
      .put(`/admin/categories/${categoryId}/commercial-terms`)
      .send({ ...own, minAdvancePercent: 10, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 20 }] });
    expect(tooHigh.status).toBe(400);
    expect(JSON.stringify(tooHigh.body)).toMatch(/minimum online advance/);

    const platformKey = await adminAgent.put(`/admin/categories/${categoryId}/commercial-terms`).send({ ...own, payoutWeekday: 3 });
    expect(platformKey.status).toBe(400);

    const badTier = await adminAgent
      .put(`/admin/categories/${categoryId}/commercial-terms`)
      .send({ ...own, cancellationTiers: [{ minHoursBeforeStart: 1, refundPercent: 80, ownerPercent: 40 }] });
    expect(badTier.status).toBe(400);
  });

  test('a venue deal overrides single fields and can be removed again', async () => {
    const put = await adminAgent
      .put(`/admin/venues/${venueId}/facilities/${categoryId}/commercial-terms`)
      .send({ monthlyCommissionCap: 1000 });
    expect(put.status).toBe(200);

    const list = await adminAgent.get(`/admin/venues/${venueId}/commercial-terms`);
    expect(list.status).toBe(200);
    const row = list.body.find((f: { categoryId: string }) => f.categoryId === categoryId);
    expect(row.terms.monthlyCommissionCap).toBe(1000);
    expect(row.sources.monthlyCommissionCap).toBe('VENUE_FACILITY');
    expect(row.sources.minAdvancePercent).toBe('FACILITY');
    expect(row.own).toEqual({ monthlyCommissionCap: 1000 });

    const del = await adminAgent.delete(`/admin/venues/${venueId}/facilities/${categoryId}/commercial-terms`);
    expect(del.status).toBe(200);
    const after = (await adminAgent.get(`/admin/venues/${venueId}/commercial-terms`)).body.find(
      (f: { categoryId: string }) => f.categoryId === categoryId,
    );
    expect(after.sources.monthlyCommissionCap).toBe('FACILITY');
    expect(after.own).toBeNull();
  });

  test('a venue deal that breaks a cross-field rule is rejected', async () => {
    const res = await adminAgent
      .put(`/admin/venues/${venueId}/facilities/${categoryId}/commercial-terms`)
      .send({ minAdvancePercent: 1 });
    expect(res.status).toBe(400);
  });

  test('the default can be edited, but must stay complete and valid', async () => {
    const def = (await adminAgent.get('/admin/commercial-terms/default')).body.terms;
    const { payoutTimezone: _omit, ...incomplete } = def;
    expect((await adminAgent.put('/admin/commercial-terms/default').send(incomplete)).status).toBe(400);
    const ok = await adminAgent.put('/admin/commercial-terms/default').send({ ...def, payoutWeekday: def.payoutWeekday });
    expect(ok.status).toBe(200);
  });

  test('owners cannot edit terms but can read the ones that apply to their venue', async () => {
    expect((await ownerAgent.get('/admin/commercial-terms/default')).status).toBe(403);
    expect((await ownerAgent.put(`/admin/categories/${categoryId}/commercial-terms`).send({})).status).toBe(403);

    const res = await ownerAgent.get(`/owner/commercial-terms?venueId=${venueId}`);
    expect(res.status).toBe(200);
    const row = res.body.find((f: { categoryId: string }) => f.categoryId === categoryId);
    expect(row.terms.minAdvancePercent).toBe(40);
    expect(row).not.toHaveProperty('sources');
  });

  test('changes are audited', async () => {
    const logs = await prisma.auditLog.count({ where: { action: 'COMMERCIAL_TERMS_UPDATED', entityId: categoryId } });
    expect(logs).toBeGreaterThan(0);
  });
});
