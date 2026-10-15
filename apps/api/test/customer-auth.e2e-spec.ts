import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';
import { CUSTOMER_SESSION_COOKIE } from '../src/auth/auth.constants';

describe('customer auth (HTTP)', () => {
  let app: INestApplication;
  let messenger: FakeCustomerMessenger;
  const phone = () => `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith(`${CUSTOMER_SESSION_COOKIE}=`),
    );

  beforeAll(async () => {
    app = await createTestApp();
    messenger = app.get(CUSTOMER_MESSENGER);
  });
  afterAll(async () => app.close());

  it('full login: request, verify, me, set name, logout', async () => {
    const p = phone();
    const server = app.getHttpServer();
    await request(server).post('/customer-auth/request-code').send({ phone: p }).expect(200);
    const code = messenger.lastCodeFor(`+91${p}`)!;

    const verify = await request(server).post('/customer-auth/verify').send({ phone: p, code }).expect(200);
    expect(verify.body.needsName).toBe(true);
    const setCookie = cookieOf(verify)!;
    expect(setCookie).toMatch(/HttpOnly/i);
    const cookie = setCookie.split(';')[0]!;

    const me = await request(server).get('/customer-auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.phone).toBe(`+91${p}`);

    await request(server).patch('/customer-auth/me').set('Cookie', cookie).send({ name: 'Asha' }).expect(200);
    const again = await request(server).get('/customer-auth/me').set('Cookie', cookie).expect(200);
    expect(again.body.name).toBe('Asha');

    await request(server).post('/customer-auth/logout').set('Cookie', cookie).expect(200);
    await request(server).get('/customer-auth/me').set('Cookie', cookie).expect(401);
  });

  it('a wrong code sets no cookie', async () => {
    const p = phone();
    const server = app.getHttpServer();
    await request(server).post('/customer-auth/request-code').send({ phone: p }).expect(200);
    const res = await request(server).post('/customer-auth/verify').send({ phone: p, code: '000001' });
    expect(res.status).toBe(401);
    expect(cookieOf(res)).toBeUndefined();
  });

  it('rejects a non-numeric code with 400', async () => {
    await request(app.getHttpServer())
      .post('/customer-auth/verify')
      .send({ phone: phone(), code: 'abcdef' })
      .expect(400);
  });

  it('me requires a customer session', async () => {
    await request(app.getHttpServer()).get('/customer-auth/me').expect(401);
  });

  it('throttles request-code per IP', async () => {
    const server = app.getHttpServer();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await request(server).post('/customer-auth/request-code').send({ phone: phone() })).status);
    }
    expect(statuses).toContain(429);
  });
});
