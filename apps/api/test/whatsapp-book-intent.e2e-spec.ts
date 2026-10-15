import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import {
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
} from './setup/fixtures';

function inboundPayload(
  from: string,
  message: { type: 'text'; body: string } | { type: 'interactive'; id: string; title: string },
) {
  const messageId = `wamid.test_${Math.random().toString(36).slice(2)}`;
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                message.type === 'text'
                  ? { id: messageId, from, type: 'text', text: { body: message.body } }
                  : {
                      id: messageId,
                      from,
                      type: 'interactive',
                      interactive: { type: 'button', button_reply: { id: message.id, title: message.title } },
                    },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sendWebhook(app: INestApplication, payload: unknown) {
  const env = loadEnv();
  const rawBody = JSON.stringify(payload);
  const signature = 'sha256=' + createHmac('sha256', env.WHATSAPP_APP_SECRET!).update(rawBody).digest('hex');
  return request(app.getHttpServer())
    .post('/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signature)
    .send(rawBody);
}

/**
 * The public search page's "Book This Slot" wa.me deep link
 * (apps/web/app/page.tsx's bookSlotIntentText) landing back in WhatsApp as
 * a "Book: ..." message, parsed by WhatsAppMenuService.parseBookIntentText
 * and driven through the real webhook end to end — availability preview,
 * Yes/No confirmation, and (on Yes) an actual held Booking via the same
 * BookingsService.createHold every other path uses.
 */
describe('WhatsApp: "Book This Slot" deep link', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let facilityCode: string;

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
    facilityCode = (await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } })).facilityCode;
  });

  afterAll(async () => {
    await app.close();
  });

  function bookText(startTime: string, durationMinutes = 60): string {
    return `Book: ${facilityCode} | Resource: ${venue.halfAId} | ${startTime} | ${durationMinutes}min`;
  }

  test('an already-named customer confirming Yes gets a real held booking', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    // Onboard first so this test starts from an already-named customer.
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'E2E Book Intent' }));

    const startTime = futureStart(11, 9).toISOString();
    const sendIntent = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: bookText(startTime) }));
    expect(sendIntent.status).toBe(200);

    const confirm = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'interactive', id: 'BOOK_CONFIRM_YES', title: 'Yes' }),
    );
    expect(confirm.status).toBe(200);

    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    const booking = await prisma.booking.findFirst({ where: { customerId: customer.id, resourceId: venue.halfAId } });
    expect(booking).not.toBeNull();
    expect(booking?.status).toBe('PENDING_PAYMENT');
    expect(booking?.startTime.toISOString()).toBe(startTime);
  });

  test('confirming No leaves no booking behind', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'E2E No Thanks' }));

    const startTime = futureStart(12, 9).toISOString();
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: bookText(startTime) }));
    const decline = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'interactive', id: 'BOOK_CONFIRM_NO', title: 'No' }),
    );
    expect(decline.status).toBe(200);

    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    const booking = await prisma.booking.findFirst({ where: { customerId: customer.id, resourceId: venue.halfAId } });
    expect(booking).toBeNull();
  });

  test('a brand-new (unnamed) contact\'s first message being a book intent still books after they give their name', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const startTime = futureStart(13, 9).toISOString();

    // First message ever from this number IS the deep-link text — must
    // be asked for their name first (WhatsAppMenuState's pendingBookIntent
    // carries the intent through onboarding), not lose the booking.
    const firstMessage = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: bookText(startTime) }));
    expect(firstMessage.status).toBe(200);

    const beforeName = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    expect(beforeName.name).toBeNull();

    const nameReply = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'E2E New Contact' }));
    expect(nameReply.status).toBe(200);

    const confirm = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'interactive', id: 'BOOK_CONFIRM_YES', title: 'Yes' }),
    );
    expect(confirm.status).toBe(200);

    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    expect(customer.name).toBe('E2E New Contact');
    const booking = await prisma.booking.findFirst({ where: { customerId: customer.id, resourceId: venue.halfAId } });
    expect(booking).not.toBeNull();
  });

  test('a non-hour-aligned or malformed "Book:" text is treated as ordinary chat, not a crash', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'E2E Malformed' }));

    const res = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'text', body: 'Book: not-a-real-code | Resource: nope | garbage | 30min' }),
    );
    expect(res.status).toBe(200);
  });
});
