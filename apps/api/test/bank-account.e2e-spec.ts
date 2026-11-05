import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashPassword } from '@venue/database';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createStaffFixture, createVenueFixture, loginAsSuperAdmin, prisma } from './setup/fixtures';

/**
 * A business's payout details: written by its owner admin only with their password, masked for the owner and full for the Super Admin,
 * verified or failed by the Super Admin, and sent back to NOT_VERIFIED by every real change.
 */
describe('Business bank details', () => {
  const PASSWORD = 'Correct-horse-9';
  let app: INestApplication;
  let adminAgent: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
  let owner: Awaited<ReturnType<typeof createOwnerFixture>>;
  let ownerId: string;
  let venueId: string;

  const details = (over: Record<string, unknown> = {}) => ({
    accountHolderName: 'Greenfield Sports LLP',
    accountNumber: '123456789012',
    ifsc: 'hdfc0001234',
    bankName: 'HDFC Bank',
    branch: 'Kozhikode',
    accountType: 'CURRENT',
    upiId: 'greenfield@hdfcbank',
    password: PASSWORD,
    ...over,
  });
  const bank = () => prisma.organizationBankAccount.findUnique({ where: { organizationId: owner.organizationId } });

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    owner = await createOwnerFixture(app, adminAgent);
    const row = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId: owner.organizationId, role: 'OWNER_ADMIN' } });
    ownerId = row.id;
    await prisma.venueOwnerUser.update({ where: { id: ownerId }, data: { passwordHash: await hashPassword(PASSWORD) } });
    venueId = (await createVenueFixture(app, owner.ownerAgent, adminAgent)).venueId;
  });
  afterAll(async () => {
    await app.close();
  });

  test('nothing is saved yet: the owner and the admin both get status NONE', async () => {
    expect((await owner.ownerAgent.get('/owner/bank-account')).body).toEqual({ status: 'NONE' });
    expect((await adminAgent.get(`/admin/organizations/${owner.organizationId}/bank-account`)).body).toEqual({ status: 'NONE' });
  });

  test('a wrong or missing password changes nothing', async () => {
    const wrong = await owner.ownerAgent.put('/owner/bank-account').send(details({ password: 'nope' }));
    expect(wrong.status).toBe(403);
    expect(wrong.body.message).toMatch(/password is not right/i);
    const { password: _omit, ...noPassword } = details();
    expect((await owner.ownerAgent.put('/owner/bank-account').send(noPassword)).status).toBe(400);
    expect(await bank()).toBeNull();
  });

  test('with the password the details are saved as NOT_VERIFIED, tidied up, and masked for the owner', async () => {
    const res = await owner.ownerAgent.put('/owner/bank-account').send(details({ accountNumber: '1234 5678 9012' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'NOT_VERIFIED', ifsc: 'HDFC0001234', accountNumber: '••••••••9012', accountNumberLast4: '9012', accountType: 'CURRENT' });
    expect(JSON.stringify(res.body)).not.toContain('123456789012');
    expect((await bank())?.accountNumber).toBe('123456789012');
    expect(JSON.stringify((await owner.ownerAgent.get('/owner/bank-account')).body)).not.toContain('123456789012');

    const forAdmin = await adminAgent.get(`/admin/organizations/${owner.organizationId}/bank-account`);
    expect(forAdmin.body).toMatchObject({ accountNumber: '123456789012', status: 'NOT_VERIFIED', accountHolderName: 'Greenfield Sports LLP' });
    const log = await prisma.auditLog.findFirst({ where: { action: 'BANK_ACCOUNT_ADDED', entityId: owner.organizationId } });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.metadata)).not.toContain('123456789012');
  });

  test('the details are checked', async () => {
    const bad = async (over: Record<string, unknown>) => (await owner.ownerAgent.put('/owner/bank-account').send(details(over))).status;
    expect(await bad({ ifsc: 'HDFC1234567' })).toBe(400); // fifth character must be 0
    expect(await bad({ ifsc: 'HDF0001234' })).toBe(400);
    expect(await bad({ accountNumber: '12345678' })).toBe(400); // too short
    expect(await bad({ accountNumber: '12345678901234567890' })).toBe(400); // too long
    expect(await bad({ accountNumber: '12345abc9012' })).toBe(400);
    expect(await bad({ accountHolderName: ' ' })).toBe(400);
    expect(await bad({ bankName: '' })).toBe(400);
    expect(await bad({ upiId: 'not a upi' })).toBe(400);
    expect(await bad({ accountType: 'GOLD' })).toBe(400);
    expect(await bad({ upiId: '', branch: '' })).toBe(200); // both optional
    await owner.ownerAgent.put('/owner/bank-account').send(details());
  });

  test('the admin verifies; saving the same details again keeps it verified', async () => {
    const res = await adminAgent.post(`/admin/organizations/${owner.organizationId}/bank-account/verify`).send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'VERIFIED', failureReason: null });
    expect(res.body.verifiedAt).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: 'BANK_ACCOUNT_VERIFIED', entityId: owner.organizationId } })).toBe(1);
    const note = await prisma.ownerNotification.findFirst({ where: { ownerId, title: 'Bank details verified' } });
    expect(note?.message).toContain('9012');

    // Already decided: cannot be verified or failed again.
    expect((await adminAgent.post(`/admin/organizations/${owner.organizationId}/bank-account/verify`).send({})).status).toBe(400);
    expect((await adminAgent.post(`/admin/organizations/${owner.organizationId}/bank-account/fail`).send({ reason: 'No' })).status).toBe(400);

    // The same details, typed differently, are not a change.
    const same = await owner.ownerAgent.put('/owner/bank-account').send(details({ ifsc: ' HDFC0001234 ', accountNumber: '1234-5678-9012' }));
    expect(same.status).toBe(200);
    expect(same.body.status).toBe('VERIFIED');
  });

  test('changing any detail (with the password) sends VERIFIED back to NOT_VERIFIED; a wrong password cannot', async () => {
    const refused = await owner.ownerAgent.put('/owner/bank-account').send(details({ accountNumber: '999988887777', password: 'wrong-one' }));
    expect(refused.status).toBe(403);
    expect((await bank())?.accountNumber).toBe('123456789012');
    expect((await bank())?.status).toBe('VERIFIED');

    const changes = () => prisma.auditLog.count({ where: { action: 'BANK_ACCOUNT_CHANGED', entityId: owner.organizationId } });
    const before = await changes();
    const changed = await owner.ownerAgent.put('/owner/bank-account').send(details({ accountNumber: '999988887777' }));
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ status: 'NOT_VERIFIED', failureReason: null, verifiedAt: null, accountNumberLast4: '7777' });
    expect((await bank())?.verifiedByAdminId).toBeNull();
    expect(await changes()).toBe(before + 1);
  });

  test('failing needs a reason, shows it to the owner, and an edit puts it back to NOT_VERIFIED', async () => {
    const path = `/admin/organizations/${owner.organizationId}/bank-account/fail`;
    expect((await adminAgent.post(path).send({})).status).toBe(400);
    expect((await adminAgent.post(path).send({ reason: '  ' })).status).toBe(400);
    expect((await adminAgent.post(path).send({ reason: 'Name does not match the bank record' })).status).toBe(201);
    const seen = (await owner.ownerAgent.get('/owner/bank-account')).body;
    expect(seen).toMatchObject({ status: 'FAILED', failureReason: 'Name does not match the bank record' });
    expect(await prisma.ownerNotification.count({ where: { ownerId, title: 'Bank details need fixing' } })).toBe(1);

    const fixed = await owner.ownerAgent.put('/owner/bank-account').send(details({ accountNumber: '999988887777', accountHolderName: 'Greenfield Sports' }));
    expect(fixed.body).toMatchObject({ status: 'NOT_VERIFIED', failureReason: null });
  });

  test('staff, customers and other businesses cannot read or change it; the admin routes are admin only', async () => {
    const staff = await createStaffFixture(app, owner.organizationId, [venueId]);
    expect((await staff.agent.get('/owner/bank-account')).status).toBe(403);
    expect((await staff.agent.put('/owner/bank-account').send(details())).status).toBe(403);
    const { agent: customer } = await createCustomerFixture(app);
    expect((await customer.get('/owner/bank-account')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/owner/bank-account')).status).toBe(401);
    expect((await owner.ownerAgent.get(`/admin/organizations/${owner.organizationId}/bank-account`)).status).toBe(403);
    expect((await owner.ownerAgent.post(`/admin/organizations/${owner.organizationId}/bank-account/verify`).send({})).status).toBe(403);

    // Another business has its own, separate record.
    const other = await createOwnerFixture(app, adminAgent);
    const otherUser = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId: other.organizationId, role: 'OWNER_ADMIN' } });
    await prisma.venueOwnerUser.update({ where: { id: otherUser.id }, data: { passwordHash: await hashPassword('Other-pass-77') } });
    expect((await other.ownerAgent.get('/owner/bank-account')).body).toEqual({ status: 'NONE' });
    // Their own password does not unlock this business; and a password from another business does not work either.
    expect((await other.ownerAgent.put('/owner/bank-account').send(details({ password: PASSWORD }))).status).toBe(403);
    expect((await other.ownerAgent.put('/owner/bank-account').send(details({ password: 'Other-pass-77', accountNumber: '555566667777' }))).status).toBe(200);
    expect((await bank())?.accountNumber).toBe('999988887777');
  });

  test('an owner without a password (not set up yet) cannot save', async () => {
    const fresh = await createOwnerFixture(app, adminAgent);
    expect((await fresh.ownerAgent.put('/owner/bank-account').send(details())).status).toBe(403);
  });

  test('the organization list says who has not been verified', async () => {
    const list = await adminAgent.get('/admin/organizations');
    const mine = list.body.find((o: { id: string }) => o.id === owner.organizationId);
    expect(mine.bankStatus).toBe('NOT_VERIFIED');
    const none = list.body.find((o: { id: string; bankStatus: string }) => o.id !== owner.organizationId && o.bankStatus === 'NONE');
    expect(none).toBeTruthy();
  });
});
