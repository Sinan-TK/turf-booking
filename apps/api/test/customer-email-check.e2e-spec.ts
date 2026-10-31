import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { prisma, uniqueSuffix } from './setup/fixtures';

/** The customer sign-up form can ask whether an email already has a customer account. */
describe('Customer email check', () => {
  let app: INestApplication;
  const email = `e2e-cust-${uniqueSuffix().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}@example.com`;
  const check = (value: string) => request(app.getHttpServer()).post('/customer-auth/email-check').send({ email: value });

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    await prisma.customerProfile.create({ data: { name: 'E2E Customer', email, whatsappNumber: `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}` } });
  });
  afterAll(async () => {
    await prisma.customerProfile.deleteMany({ where: { email } });
    await app.close();
  });

  it('says an address is taken (any letter case) and another is free', async () => {
    expect((await check(email)).body).toEqual({ available: false });
    expect((await check(email.toUpperCase())).body).toEqual({ available: false });
    expect((await check(`free-${email}`)).body).toEqual({ available: true });
  });

  it('only counts customers: an owner or the Super Admin with that address does not make it taken', async () => {
    expect((await check('admin@turf.local')).body).toEqual({ available: true });
    const owner = await prisma.venueOwnerUser.findFirst({ select: { email: true } });
    if (owner) expect((await check(owner.email)).body).toEqual({ available: true });
  });

  it('refuses something that is not an email address', async () => {
    expect((await check('nope')).status).toBe(400);
  });

  it('sign-up itself still refuses a taken address with a plain message', async () => {
    const res = await request(app.getHttpServer()).post('/customer-auth/signup').send({ name: 'Someone', email, phone: '9847012345', password: 'Longenough123!' });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already registered/i);
  });
});
