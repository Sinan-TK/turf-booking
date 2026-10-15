import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '@venue/config';
import { WhatsAppMenuService, type InboundMessage } from './whatsapp-menu.service';
import { WhatsAppClientService } from './whatsapp-client.service';
import { maskPhone } from './whatsapp-logging.util';

/** Minimal shape of the fields this handler actually reads — the real
 * payload carries more (statuses, contacts, etc.) that are irrelevant here. */
export interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          interactive?: {
            type: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
        }>;
      };
    }>;
  }>;
}

export interface ExtractedInboundMessage {
  id: string;
  from: string;
  message: InboundMessage;
}

/**
 * Webhook use-case: owns Meta's verification handshake, HMAC signature
 * check, payload extraction, and sequential batch processing. The
 * controller stays a thin HTTP adapter (Clean Architecture) — it only
 * passes rawBody/signature/body through and maps the result to HTTP.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly menu: WhatsAppMenuService,
    private readonly client: WhatsAppClientService,
  ) {}

  /** Meta's one-time webhook verification handshake (§15). */
  verifyHandshake(mode: string, token: string, challenge: string): string {
    const env = loadEnv();
    if (
      mode === 'subscribe' &&
      token &&
      env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
      safeCompare(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
    ) {
      return challenge;
    }
    throw new UnauthorizedException('Webhook verification failed');
  }

  verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const env = loadEnv();
    if (!env.WHATSAPP_APP_SECRET) {
      // No secret configured. In production that must never mean "accept
      // anything" (anyone could then forge inbound messages / sessions),
      // so fail closed. Elsewhere (local dev without real Meta
      // credentials, e2e) allow through so the menu flow can be exercised
      // via simulated webhook calls.
      if (env.NODE_ENV === 'production') {
        this.logger.error('WHATSAPP_APP_SECRET is not set; rejecting unsigned webhook in production');
        return false;
      }
      return true;
    }
    if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
    const provided = signatureHeader.slice('sha256='.length);
    return safeCompare(expected, provided);
  }

  extractMessages(body: WhatsAppWebhookPayload): ExtractedInboundMessage[] {
    const results: ExtractedInboundMessage[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (msg.type === 'text' && msg.text) {
            results.push({ id: msg.id, from: msg.from, message: { kind: 'text', text: msg.text.body } });
          } else if (msg.type === 'interactive' && msg.interactive) {
            const reply = msg.interactive.button_reply ?? msg.interactive.list_reply;
            if (reply) {
              results.push({
                id: msg.id,
                from: msg.from,
                message: { kind: 'interactive_reply', id: reply.id, title: reply.title },
              });
            }
          }
        }
      }
    }
    return results;
  }

  /**
   * Processes one webhook payload: signature already verified by the
   * caller. Never lets one malformed message block the rest, and never
   * throws for downstream failures (Meta must always get a 200 ack).
   * Deliberately sequential — messages may belong to the same
   * customer/session, and concurrent processing risks a session-state race.
   */
  async processWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    body: WhatsAppWebhookPayload,
  ): Promise<{ status: string }> {
    if (!this.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const messages = this.extractMessages(body);

    const batchStartedAt = Date.now();
    if (messages.length > 1) {
      this.logger.warn(`[WA] webhook batch: ${messages.length} messages in one payload`);
    } else if (messages.length === 1) {
      this.logger.log('[WA] webhook batch: 1 message');
    }

    for (const [index, { id, from, message }] of messages.entries()) {
      const waitedMs = Date.now() - batchStartedAt;
      if (index > 0) {
        this.logger.log(
          `[WA] message ${index + 1}/${messages.length} (customer: ${maskPhone(from)}) started after waiting ${waitedMs}ms behind earlier messages in this batch`,
        );
      }

      try {
        await this.client.sendTypingIndicator(id);
      } catch {
        this.logger.warn('[WA] typing indicator failed, continuing without it');
      }

      try {
        await this.menu.handleInboundMessage(normalizePhone(from), message);
      } catch {
        // WhatsAppMenuService already catches and reports its own
        // errors to the user; this is a last-resort guard so one bad
        // message never breaks the batch.
      }
    }

    return { status: 'ok' };
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function normalizePhone(from: string): string {
  return from.startsWith('+') ? from : `+${from}`;
}
