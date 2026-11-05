import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { cspReportContentType } from '../../src/health/csp-report.middleware';
import { RazorpayProvider } from '../../src/payments/razorpay.provider';
import { PAYMENT_PROVIDER, type GatewayPayment } from '../../src/payments/payment-provider.interface';
import {
  CUSTOMER_MESSENGER,
  type CustomerMessenger,
} from '../../src/customer-messaging/customer-messenger.port';

/** Captures what would be sent to customers; never touches WhatsApp. */
export class FakeCustomerMessenger implements CustomerMessenger {
  codes: Array<{ phone: string; code: string }> = [];
  failNext = false;
  confirmed: Array<{ phone: string; orderId: string }> = [];
  cancelled: Array<{ phone: string; orderId: string }> = [];
  lateRefunds: Array<{ phone: string; orderId: string; coins: string }> = [];
  async bookingConfirmed(phone: string, orderId: string) {
    this.confirmed.push({ phone, orderId });
  }
  async bookingCancelled(phone: string, orderId: string) {
    this.cancelled.push({ phone, orderId });
  }
  async latePaymentRefunded(phone: string, orderId: string, coins: string) {
    this.lateRefunds.push({ phone, orderId, coins });
  }
  async loginCode(phone: string, code: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('send failed');
    }
    this.codes.push({ phone, code });
  }
  lastCodeFor(phone: string) {
    return [...this.codes].reverse().find((c) => c.phone === phone)?.code;
  }
}

// Real Razorpay's orders.create() makes a network call this sandboxed
// test environment can't make (and shouldn't need to, to prove our own
// booking/payment logic is correct) — override only createOrder, keeping
// verifyWebhookSignature/verifyClientSignature/parseWebhookPayload real
// (inherited unchanged) so webhook tests still exercise genuine HMAC
// verification against RAZORPAY_WEBHOOK_SECRET, exactly like the
// self-signed curl payloads used in Phase 6's manual testing.
/**
 * What the pretend gateway knows: the payment attempts made on each order. A spec "pays" an order with `fakeGateway.capture(orderId, amountMinor)`;
 * the service then finds the payment when it asks the gateway (client confirmation, sync, reconciler) exactly as it would with Razorpay.
 */
export const fakeGateway = {
  attempts: new Map<string, GatewayPayment[]>(),
  /** The gateway took the money (captured). Returns the payment id. */
  capture(orderId: string, amountMinorUnits: number, currency = 'INR'): string {
    return this.add(orderId, amountMinorUnits, 'captured', currency);
  },
  /** The money was authorized but not captured yet. */
  authorize(orderId: string, amountMinorUnits: number, currency = 'INR'): string {
    return this.add(orderId, amountMinorUnits, 'authorized', currency);
  },
  add(orderId: string, amountMinorUnits: number, status: string, currency = 'INR'): string {
    const id = `pay_test_${randomUUID().slice(0, 12)}`;
    this.attempts.set(orderId, [...(this.attempts.get(orderId) ?? []), { id, orderId, status, amountMinorUnits, currency }]);
    return id;
  },
  /** Make every question to the gateway fail, as in an outage. */
  down: false,
  reset() {
    this.attempts.clear();
    this.down = false;
  },
};

class FakeRazorpayProvider extends RazorpayProvider {
  override async fetchPayment(id: string) {
    if (fakeGateway.down) throw new Error('gateway unreachable');
    for (const list of fakeGateway.attempts.values()) {
      const found = list.find((p) => p.id === id);
      if (found) return { ...found };
    }
    return null;
  }
  override async fetchOrderPayments(orderId: string) {
    if (fakeGateway.down) throw new Error('gateway unreachable');
    return (fakeGateway.attempts.get(orderId) ?? []).map((p) => ({ ...p }));
  }
  override async capturePayment(id: string) {
    for (const list of fakeGateway.attempts.values()) {
      const found = list.find((p) => p.id === id);
      if (found) {
        found.status = 'captured';
        return { ...found };
      }
    }
    throw new Error('unknown payment');
  }
  override async createOrder(params: { amountMinorUnits: number; currency: string; receipt: string }) {
    const gatewayOrderId = `order_test_${randomUUID().slice(0, 12)}`;
    return { gatewayOrderId, raw: { id: gatewayOrderId, ...params } };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(BigInt.prototype as any).toJSON) {
  // Same polyfill as main.ts — Booking.orderSeq is a BigInt and
  // supertest's response.body parsing goes through JSON.stringify just
  // like a real client would.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

/**
 * `throttle: false` switches the rate limiter off, for specs that must call one endpoint more often than its
 * per-minute limit allows (the limits themselves are covered where they are the point, e.g. customer-auth).
 */
export async function createTestApp(options: { throttle?: boolean } = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RazorpayProvider)
    .useClass(FakeRazorpayProvider)
    .overrideProvider(PAYMENT_PROVIDER)
    .useClass(FakeRazorpayProvider)
    .overrideProvider(CUSTOMER_MESSENGER)
    .useValue(new FakeCustomerMessenger());
  if (options.throttle === false) {
    // Every request counts as the first one in its window, so no limit is ever reached.
    builder = builder.overrideProvider(ThrottlerStorage).useValue({
      increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    });
  }
  const moduleFixture = await builder.compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  app.use('/csp-report', cspReportContentType);
  app.use(cookieParser());
  await app.init();
  return app;
}
