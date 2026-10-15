import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import { prisma, uniqueSuffix } from './setup/fixtures';

function inboundPayload(
  from: string,
  message:
    | { type: 'text'; body: string }
    | { type: 'interactive'; id: string; title: string },
) {
  // Real Meta payloads always carry a message id — included here so the
  // webhook's typing-indicator call (which needs it) is exercised
  // exactly as it would be against real traffic, not against an
  // accidentally-undefined id that only "works" because the test
  // environment has no real WhatsApp credentials configured.
  const messageId = `wamid.test_${Math.random().toString(36).slice(2)}`;
  const base = {
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
                      interactive: {
                        type: 'button',
                        button_reply: { id: message.id, title: message.title },
                      },
                    },
              ],
            },
          },
        ],
      },
    ],
  };
  return base;
}

function sendWebhook(app: INestApplication, payload: unknown) {
  const env = loadEnv();
  const rawBody = JSON.stringify(payload);
  const signature =
    'sha256=' + createHmac('sha256', env.WHATSAPP_APP_SECRET!).update(rawBody).digest('hex');
  return request(app.getHttpServer())
    .post('/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signature)
    .send(rawBody);
}

/**
 * WhatsApp onboarding (ask a not-yet-named contact for their name before
 * anything else) and the Profile "Edit Name" flow. Drives the real
 * webhook — including genuine HMAC signature verification against
 * WHATSAPP_APP_SECRET, same as payments.e2e-spec.ts's webhook tests —
 * rather than calling WhatsAppMenuService directly, so it also proves
 * the controller wiring and the session-state machine, not just the
 * name-capture logic in isolation.
 */
describe('WhatsApp: name onboarding and profile edit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('a brand-new contact is asked for their name before the main menu, and it is saved', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

    const first = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));
    expect(first.status).toBe(200);

    const afterFirstMessage = await prisma.customerProfile.findUniqueOrThrow({
      where: { whatsappNumber },
    });
    expect(afterFirstMessage.name).toBeNull();

    const name = `E2E Name ${uniqueSuffix()}`;
    const second = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: name }));
    expect(second.status).toBe(200);

    const afterNameReply = await prisma.customerProfile.findUniqueOrThrow({
      where: { whatsappNumber },
    });
    expect(afterNameReply.name).toBe(name);
  });

  test('a name-like first reply is not mistaken for the "hi" shortcut', async () => {
    // Guards the ordering in WhatsAppMenuService.handleInboundMessage: the
    // missing-name check must run before the "hi/hello/menu" regex, or an
    // onboarding contact who replies with something matching that regex
    // would skip straight to the main menu with no name ever asked.
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));

    const res = await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'menu' }));
    expect(res.status).toBe(200);

    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    expect(customer.name).toBe('menu');
  });

  test('an existing customer can edit their name from the Profile menu', async () => {
    const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const originalName = `E2E Original ${uniqueSuffix()}`;

    // Onboard first so this test starts from an already-named customer.
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: originalName }));

    // "hi" again re-arms the main menu regardless of whatever screen
    // onboarding left the session on.
    await sendWebhook(app, inboundPayload(whatsappNumber, { type: 'text', body: 'hi' }));

    const openProfile = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'interactive', id: 'MENU_PROFILE', title: 'Profile' }),
    );
    expect(openProfile.status).toBe(200);

    const clickEdit = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'interactive', id: 'EDIT_NAME', title: 'Edit Name' }),
    );
    expect(clickEdit.status).toBe(200);

    const newName = `E2E Updated ${uniqueSuffix()}`;
    const submitName = await sendWebhook(
      app,
      inboundPayload(whatsappNumber, { type: 'text', body: newName }),
    );
    expect(submitName.status).toBe(200);

    const customer = await prisma.customerProfile.findUniqueOrThrow({ where: { whatsappNumber } });
    expect(customer.name).toBe(newName);
    expect(customer.name).not.toBe(originalName);
  });

  test('an invalid webhook signature is rejected', async () => {
    const res = await request(app.getHttpServer())
      .post('/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=' + '0'.repeat(64))
      .send(JSON.stringify(inboundPayload('+919999999999', { type: 'text', body: 'hi' })));
    expect(res.status).toBe(401);
  });
});
