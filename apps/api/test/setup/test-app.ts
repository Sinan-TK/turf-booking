import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { RazorpayProvider } from '../../src/payments/razorpay.provider';
import { PAYMENT_PROVIDER } from '../../src/payments/payment-provider.interface';

// Real Razorpay's orders.create() makes a network call this sandboxed
// test environment can't make (and shouldn't need to, to prove our own
// booking/payment logic is correct) — override only createOrder, keeping
// verifyWebhookSignature/verifyClientSignature/parseWebhookPayload real
// (inherited unchanged) so webhook tests still exercise genuine HMAC
// verification against RAZORPAY_WEBHOOK_SECRET, exactly like the
// self-signed curl payloads used in Phase 6's manual testing.
class FakeRazorpayProvider extends RazorpayProvider {
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

export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RazorpayProvider)
    .useClass(FakeRazorpayProvider)
    .overrideProvider(PAYMENT_PROVIDER)
    .useClass(FakeRazorpayProvider)
    .compile();

  const app = moduleFixture.createNestApplication({ rawBody: true });
  app.use(cookieParser());
  await app.init();
  return app;
}
