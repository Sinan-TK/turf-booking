import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { prisma } from './setup/fixtures';
import { BookingSessionsService } from '../src/booking-sessions/booking-sessions.service';
import { CUSTOMER_SESSION_COOKIE } from '../src/auth/auth.constants';

/**
 * The WhatsApp -> web handoff (ARCHITECTURE.md §15): opening
 * /book/:token must both resolve the BookingSession and authenticate the
 * browser as that customer, in one call, since the raw CustomerSession
 * token can only ever be handed over via this response's Set-Cookie —
 * it's never persisted anywhere in recoverable form. Formalizes the fix
 * for a real bug found while building the customer web app: the previous
 * version minted the CustomerSession back when the WhatsApp link was
 * created, whose raw token was immediately discarded and unrecoverable,
 * permanently orphaning that session row.
 */
describe('BookingSession -> CustomerSession handoff', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function cookieValue(res: request.Response, name: string): string | undefined {
    const raw = res.headers['set-cookie'];
    const jar: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const found = jar.find((c) => c.startsWith(`${name}=`));
    return found?.split(';')[0];
  }

  test('opening the link resolves the session and authenticates the browser', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const { bookingSessionToken } = await app
      .get(BookingSessionsService)
      .start(whatsappNumber, 'WHATSAPP');

    const resolveRes = await request(app.getHttpServer()).get(
      `/booking-sessions/${bookingSessionToken}`,
    );
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.expiresAt).toBeDefined();

    const cookie = cookieValue(resolveRes, CUSTOMER_SESSION_COOKIE);
    expect(cookie).toBeDefined();

    // The cookie must actually authenticate — not just be present.
    const authed = await request(app.getHttpServer())
      .get('/me/bookings')
      .set('Cookie', cookie!);
    expect(authed.status).toBe(200);
    expect(Array.isArray(authed.body)).toBe(true);
  });

  test('an unknown token is rejected and issues no session', async () => {
    const res = await request(app.getHttpServer()).get('/booking-sessions/not-a-real-token');
    expect(res.status).toBe(404);
    expect(cookieValue(res, CUSTOMER_SESSION_COOKIE)).toBeUndefined();
  });

  test('an expired BookingSession is rejected and issues no session', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const { bookingSessionToken, session } = await app
      .get(BookingSessionsService)
      .start(whatsappNumber, 'WHATSAPP');
    await prisma.bookingSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app.getHttpServer()).get(`/booking-sessions/${bookingSessionToken}`);
    expect(res.status).toBe(404);
    expect(cookieValue(res, CUSTOMER_SESSION_COOKIE)).toBeUndefined();
  });
});
