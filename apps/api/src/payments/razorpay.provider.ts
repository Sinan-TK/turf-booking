import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { loadEnv } from '@venue/config';
import type { CreateOrderResult, GatewayPayment, PaymentProvider } from './payment-provider.interface';

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

  async fetchPayment(gatewayPaymentId: string): Promise<GatewayPayment | null> {
    try {
      return toGatewayPayment(await this.client.payments.fetch(gatewayPaymentId));
    } catch (error) {
      // Razorpay answers 400/404 for an id it does not know; anything else (network, 5xx) is a real failure the caller must see.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 400 || status === 404) return null;
      throw error;
    }
  }

  async fetchOrderPayments(gatewayOrderId: string): Promise<GatewayPayment[]> {
    const result = await this.client.orders.fetchPayments(gatewayOrderId);
    return (result.items ?? []).map(toGatewayPayment);
  }

  async capturePayment(gatewayPaymentId: string, amountMinorUnits: number, currency: string): Promise<GatewayPayment> {
    return toGatewayPayment(await this.client.payments.capture(gatewayPaymentId, amountMinorUnits, currency));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toGatewayPayment(p: any): GatewayPayment {
  return { id: p.id, orderId: p.order_id, status: p.status, amountMinorUnits: Number(p.amount), currency: String(p.currency ?? 'INR') };
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
