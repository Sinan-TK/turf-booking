/**
 * ARCHITECTURE.md §9 / §1 assumption #1: payments go through this
 * abstraction so a future gateway (Stripe/PayPal, for global markets
 * Razorpay doesn't serve) can be added without touching booking/coin
 * logic. Razorpay is the only implementation for v1.
 */
export interface CreateOrderResult {
  gatewayOrderId: string;
  raw: unknown;
}

export interface WebhookVerificationResult {
  valid: boolean;
  eventId: string;
  eventType: string;
  payload: unknown;
}

/** A payment as the gateway itself reports it (the source of truth when a webhook is late or lost). */
export interface GatewayPayment {
  id: string;
  orderId: string;
  /** Razorpay's: created | authorized | captured | refunded | failed */
  status: string;
  amountMinorUnits: number;
  currency: string;
}

export interface PaymentProvider {
  /** amount in the currency's smallest unit (e.g. paise for INR). */
  createOrder(params: {
    amountMinorUnits: number;
    currency: string;
    receipt: string;
  }): Promise<CreateOrderResult>;

  /** Client-callback fast-path verification (§9 step 4) — never the sole source of truth. */
  verifyClientSignature(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }): boolean;

  /** Webhook signature verification against the raw request body (§9 step 5, §17). */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;

  parseWebhookPayload(rawBody: Buffer): { eventId: string; eventType: string; payload: unknown };

  /** Asks the gateway for one payment (null when it does not know it). */
  fetchPayment(gatewayPaymentId: string): Promise<GatewayPayment | null>;
  /** Every payment attempt made on an order. */
  fetchOrderPayments(gatewayOrderId: string): Promise<GatewayPayment[]>;
  /** Captures a payment that was only authorized (when the account is not set to capture automatically). */
  capturePayment(gatewayPaymentId: string, amountMinorUnits: number, currency: string): Promise<GatewayPayment>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
