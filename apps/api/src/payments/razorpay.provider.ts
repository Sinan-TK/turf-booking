import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { loadEnv } from '@venue/config';
import type { CreateOrderResult, PaymentProvider } from './payment-provider.interface';

@Injectable()
export class RazorpayProvider implements PaymentProvider {
  private readonly client: Razorpay;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor() {
    const env = loadEnv();
    // Deliberately not throwing here if these are unset — dev/CI can boot
    // without real Razorpay credentials (other modules still need to
    // work); the failure surfaces at first actual use instead, with a
    // clear error rather than a silent no-op.
    this.keySecret = env.RAZORPAY_KEY_SECRET ?? '';
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? '';
    this.client = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID ?? '',
      key_secret: this.keySecret,
    });
  }

  async createOrder(params: {
    amountMinorUnits: number;
    currency: string;
    receipt: string;
  }): Promise<CreateOrderResult> {
    const order = await this.client.orders.create({
      amount: params.amountMinorUnits,
      currency: params.currency,
      receipt: params.receipt,
    });
    return { gatewayOrderId: order.id, raw: order };
  }

  /**
   * §9 step 4: the checkout success callback's HMAC over
   * `order_id|payment_id`, signed with the same key secret. A legitimate
   * proof of payment per Razorpay's own protocol — used only as a fast
   * UI path, never the sole confirmation (see PaymentsService).
   */
  verifyClientSignature(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }): boolean {
    const expected = createHmac('sha256', this.keySecret)
      .update(`${params.gatewayOrderId}|${params.gatewayPaymentId}`)
      .digest('hex');
    return safeCompare(expected, params.signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    return safeCompare(expected, signatureHeader);
  }

  parseWebhookPayload(rawBody: Buffer): { eventId: string; eventType: string; payload: unknown } {
    const payload = JSON.parse(rawBody.toString('utf8'));
    return {
      // Razorpay sends X-Razorpay-Event-Id, read by the caller and
      // passed through PaymentsController — this method only parses the
      // body, so eventId here is a fallback derived from the payload for
      // callers that don't have the header (kept internally consistent;
      // PaymentsService always prefers the header when present).
      eventId:
        payload.payload?.payment?.entity?.id ?? payload.payload?.order?.entity?.id ?? 'unknown',
      eventType: payload.event,
      payload,
    };
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
