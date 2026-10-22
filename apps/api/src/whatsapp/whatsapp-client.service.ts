import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@venue/config';
import { maskPhone } from './whatsapp-logging.util';

/**
 * Thin wrapper over the Meta WhatsApp Cloud API. WhatsApp is outbound only: the login one-time code,
 * and the booking confirmed / cancelled messages with the booking id. There is no inbound chat bot.
 * Falls back to logging instead of calling the real API when credentials aren't configured, so
 * development works without a WhatsApp Business account. In production, with real
 * WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID set, every call here goes to the real Graph API.
 */
@Injectable()
export class WhatsAppClientService {
  private readonly logger = new Logger(WhatsAppClientService.name);

  private get configured(): boolean {
    const env = loadEnv();
    return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
  }

  async sendText(to: string, body: string): Promise<void> {
    return this.send(to, { type: 'text', text: { body } });
  }

  /**
   * Outside a live customer conversation (a notification, not a reply),
   * Meta requires a pre-approved template, not free-form text (§15's
   * 24-hour window rule). `templateName`/`params` are passed straight
   * through to the Graph API's template payload — the actual template
   * must exist and be approved in the Meta Business account this runs
   * against, which is a WhatsApp Business Platform configuration step
   * outside this codebase.
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    params: string[],
  ): Promise<void> {
    return this.send(to, {
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async send(to: string, messagePayload: Record<string, any>): Promise<void> {
    const messageType = messagePayload.type;
    await this.postToMessagesEndpoint(
      { messaging_product: 'whatsapp', to, ...messagePayload },
      { id: maskPhone(to), label: messageType },
    );
  }

  /**
   * Shared Graph API request plumbing — URL, auth, timeout, dry-run
   * fallback, and [WA] timing/error logging — used by every outbound
   * call this service makes (send() and sendTypingIndicator()) so
   * there's exactly one place that builds a Graph API request. Behavior
   * for normal outbound messages (send()) is unchanged from before this
   * was extracted; `context.id` is whatever safe identifier the caller
   * wants correlated in the logs (a masked phone number for outbound
   * sends, the Meta message id — not personal data — for the typing
   * indicator).
   */
  private async postToMessagesEndpoint(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: Record<string, any>,
    context: { id: string; label: string },
  ): Promise<void> {
    const env = loadEnv();

    if (!this.configured) {
      this.logger.log(`[WA] DRY RUN send (id: ${context.id}, type: ${context.label})`);
      return;
    }

    // A hung Graph API call would otherwise hold this request open
    // indefinitely — the customer just sees no reply with no way to
    // know why. 8s comfortably covers Meta's normal response time
    // without leaving a slow request to stall the whole exchange.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    // Timing instrumentation (temporary — added to diagnose reported
    // "late WhatsApp reply" behavior in production; safe to remove once
    // the real bottleneck is confirmed from these numbers). Logged
    // regardless of outcome so a slow *failure* is just as visible as a
    // slow success. Never logs the access token, Authorization header,
    // full phone number, or message body/content.
    const startedAt = Date.now();
    this.logger.log(`[WA] Graph API request started (id: ${context.id}, type: ${context.label})`);
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      this.logger.log(
        `[WA] Graph API response: ${Date.now() - startedAt}ms (id: ${context.id}, status: ${response.status})`,
      );

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`WhatsApp request failed (${response.status}): ${errorBody}`);
      } else if (context.label === 'typing indicator') {
        this.logger.log(`[WA] typing indicator sent (message: ${context.id})`);
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const detail = isTimeout ? 'timed out after 8s' : `threw: ${(error as Error).message}`;
      this.logger.error(
        `[WA] Graph API request failed after ${Date.now() - startedAt}ms (id: ${context.id}) — ${detail}`,
      );
      if (context.label === 'typing indicator') {
        this.logger.warn(`[WA] typing indicator failed: ${detail}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
