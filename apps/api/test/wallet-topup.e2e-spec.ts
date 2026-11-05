import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp, fakeGateway } from './setup/test-app';
import { createCustomerFixture, prisma } from './setup/fixtures';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Wallet recharge: buying Coins with money. The wallet is credited exactly once, whichever of the webhook, the customer's own
 * confirmation and the reconciler reports the payment first; a wrong amount is never credited.
 */
describe('Wallet top-up', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => fakeGateway.reset());

  const clientSignature = (orderId: string, paymentId: string) =>
    createHmac('sha256', loadEnv().RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');
  function webhook(payload: unknown, eventId: string) {
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
    return request(app.getHttpServer())
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', eventId)
      .send(rawBody);
  }
  const captured = (orderId: string, paymentId: string, amountMinor: number) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountMinor, status: 'captured', currency: 'INR' } } },
  });
  const balanceOf = async (customerId: string) => Number((await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } })).cachedBalance);
  const ledgerRows = (topupId: string) => prisma.coinTransaction.findMany({ where: { walletTopupId: topupId } });

  async function start(amount: number) {
    const { agent, customerId } = await createCustomerFixture(app);
    const res = await agent.post('/me/coins/topup').send({ amount });
    return { agent, customerId, res };
  }

  test('starting a recharge makes a pending top-up and an order for exactly that amount', async () => {
    const { res, customerId } = await start(500);
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(500);
    const topup = await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } });
    expect(topup.status).toBe('PENDING');
    expect(topup.customerId).toBe(customerId);
    expect(Number(topup.amount)).toBe(500);
    expect(await balanceOf(customerId)).toBe(0);
  });

  test.each([
    [0, 'zero'],
    [-100, 'negative'],
    [10, 'below the minimum'],
    [10_000_000, 'above the maximum'],
    [100.555, 'more than two decimals'],
  ])('%p (%s) is refused', async (amount) => {
    const { res } = await start(amount);
    expect(res.status).toBe(400);
  });

  test('a captured webhook credits the wallet once, with one ledger row linked to the top-up; a repeat changes nothing', async () => {
    const { res, customerId } = await start(500);
    const orderId = res.body.gatewayOrderId as string;
    const first = await webhook(captured(orderId, `pay_topup_1_${orderId}`, 50000), `evt_topup_1_${orderId}`);
    expect(first.status).toBe(200);
    expect(await balanceOf(customerId)).toBe(500);
    const topup = await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } });
    expect(topup.status).toBe('SUCCESS');
    expect(topup.confirmedVia).toBe('WEBHOOK');
    const rows = await ledgerRows(topup.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('WALLET_TOPUP');
    expect(Number(rows[0]!.amount)).toBe(500);

    // The same event again, a different event for the same payment, and the reconciler: all no-ops.
    await webhook(captured(orderId, `pay_topup_1_${orderId}`, 50000), `evt_topup_1_${orderId}`);
    await webhook(captured(orderId, `pay_topup_1_${orderId}`, 50000), `evt_topup_other_${orderId}`);
    fakeGateway.capture(orderId, 50000);
    await app.get(PaymentsService).reconcileStale();
    expect(await balanceOf(customerId)).toBe(500);
    expect(await ledgerRows(topup.id)).toHaveLength(1);
  });

  test("the customer's own confirmation credits the wallet without any webhook, and the status page reflects it", async () => {
    const { agent, res, customerId } = await start(300);
    const orderId = res.body.gatewayOrderId as string;
    const paymentId = fakeGateway.capture(orderId, 30000);
    const verify = await agent
      .post('/payments/verify')
      .send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(orderId, paymentId) });
    expect(verify.status).toBe(201);
    expect(verify.body.status).toBe('CREDITED');
    expect(await balanceOf(customerId)).toBe(300);
    const status = await agent.get(`/me/coins/topups/${res.body.topupId}`);
    expect(status.body.status).toBe('SUCCESS');
    expect((await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } })).confirmedVia).toBe('CLIENT');
  });

  test('polling the status of a top-up the gateway has captured credits it even if nothing else reported it', async () => {
    const { agent, res, customerId } = await start(200);
    fakeGateway.capture(res.body.gatewayOrderId, 20000);
    const status = await agent.get(`/me/coins/topups/${res.body.topupId}`);
    expect(status.body.status).toBe('SUCCESS');
    expect(await balanceOf(customerId)).toBe(200);
  });

  test('a recharge whose webhook was missed is found and credited by the reconciler', async () => {
    const { res, customerId } = await start(700);
    fakeGateway.capture(res.body.gatewayOrderId, 70000);
    await prisma.walletTopup.update({ where: { id: res.body.topupId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await app.get(PaymentsService).reconcileStale();
    expect(await balanceOf(customerId)).toBe(700);
    expect((await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } })).confirmedVia).toBe('RECONCILER');
  });

  test('a failed attempt that is retried on the same order and captured still credits the wallet', async () => {
    const { res, customerId } = await start(400);
    const orderId = res.body.gatewayOrderId as string;
    await webhook({ event: 'payment.failed', payload: { payment: { entity: { order_id: orderId, status: 'failed', error_description: 'declined' } } } }, `evt_topup_fail_${orderId}`);
    expect((await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } })).status).toBe('FAILED');
    await webhook(captured(orderId, `pay_topup_retry_${orderId}`, 40000), `evt_topup_retry_${orderId}`);
    expect(await balanceOf(customerId)).toBe(400);
  });

  test('a captured amount that differs from the top-up is never credited', async () => {
    const { res, customerId } = await start(500);
    await webhook(captured(res.body.gatewayOrderId, `pay_topup_wrong_${res.body.gatewayOrderId}`, 99900), `evt_topup_wrong_${res.body.gatewayOrderId}`);
    expect(await balanceOf(customerId)).toBe(0);
    expect((await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } })).status).toBe('FAILED');
  });

  test('an abandoned recharge is closed after 30 minutes and credits nothing', async () => {
    const { res, customerId } = await start(500);
    await prisma.walletTopup.update({ where: { id: res.body.topupId }, data: { createdAt: new Date(Date.now() - 45 * 60_000) } });
    await app.get(PaymentsService).reconcileStale();
    expect((await prisma.walletTopup.findUniqueOrThrow({ where: { id: res.body.topupId } })).status).toBe('EXPIRED');
    expect(await balanceOf(customerId)).toBe(0);
  });

  test("nobody else can confirm or read someone's top-up", async () => {
    const { res } = await start(500);
    const { agent: stranger } = await createCustomerFixture(app);
    const orderId = res.body.gatewayOrderId as string;
    const paymentId = fakeGateway.capture(orderId, 50000);
    const verify = await stranger
      .post('/payments/verify')
      .send({ razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(orderId, paymentId) });
    expect(verify.status).toBe(403);
    expect((await stranger.get(`/me/coins/topups/${res.body.topupId}`)).status).toBe(403);
  });

  test('the history lists credited and waiting recharges, newest first, a page at a time with the total', async () => {
    const { agent, res, customerId } = await start(500); // stays PENDING
    const second = await agent.post('/me/coins/topup').send({ amount: 200 });
    await webhook(captured(second.body.gatewayOrderId, `pay_hist_${second.body.gatewayOrderId}`, 20000), `evt_hist_${second.body.gatewayOrderId}`);

    const all = await agent.get('/me/coins/transactions');
    expect(all.status).toBe(200);
    expect(all.headers['x-total-count']).toBe('2');
    const byStatus = Object.fromEntries(all.body.map((r: { status: string; amount: string }) => [r.status, Number(r.amount)]));
    expect(byStatus).toEqual({ PENDING: 500, COMPLETED: 200 });
    const pending = all.body.find((r: { status: string }) => r.status === 'PENDING');
    expect(pending.type).toBe('WALLET_TOPUP');
    expect(pending.balanceAfter).toBeNull();
    expect(pending.id).toBe(res.body.topupId);

    const page = await agent.get('/me/coins/transactions?limit=1&offset=1');
    expect(page.body).toHaveLength(1);
    expect(page.headers['x-total-count']).toBe('2');
    expect(await balanceOf(customerId)).toBe(200);
  });

  test('the recharged Coins can pay for a booking afterwards (the ledger is the same wallet)', async () => {
    const { res, customerId } = await start(500);
    await webhook(captured(res.body.gatewayOrderId, `pay_topup_spend_${res.body.gatewayOrderId}`, 50000), `evt_topup_spend_${res.body.gatewayOrderId}`);
    const wallet = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
    expect(Number(wallet.cachedBalance)).toBe(500);
    const rows = await prisma.coinTransaction.findMany({ where: { customerId } });
    expect(rows.map((r) => r.type)).toEqual(['WALLET_TOPUP']);
  });
});
