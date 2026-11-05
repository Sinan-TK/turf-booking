'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/booking';
import type { RazorpayCheckoutOptions } from '@/lib/razorpay';
import { Button, ErrorBanner, Icon } from '@/components/ui';
import { PaymentSuccess } from '@/components/payment-success';

const PRESETS = [200, 500, 1000, 2000];

/**
 * "Add money": buys Coins with real money. A sheet to pick the amount, then Razorpay's popup. The Coins are credited by the server (the
 * customer's confirmation, the webhook or the reconciler, whichever arrives first); this waits for that and then shows the success moment.
 * Added money is only ever spent on bookings; it is not returned to the card.
 */
export function WalletTopupSheet({
  min,
  max,
  initialAmount,
  onClose,
  onCredited,
}: {
  min: number;
  max: number;
  initialAmount?: number;
  onClose: () => void;
  /** The Coins arrived: the wallet should be read again. */
  onCredited: (amount: number) => void;
}) {
  const [text, setText] = useState(initialAmount ? String(Math.min(max, Math.max(min, initialAmount))) : '500');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [credited, setCredited] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const amount = Number(text);
  const problem =
    text.trim() === ''
      ? 'Enter an amount.'
      : !Number.isFinite(amount) || amount <= 0
        ? 'Enter an amount above zero.'
        : Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
          ? 'Use at most two decimals.'
          : amount < min
            ? `The least you can add is ${formatPrice({ amount: String(min), currency: 'INR' })}.`
            : amount > max
              ? `The most you can add at a time is ${formatPrice({ amount: String(max), currency: 'INR' })}.`
              : null;

  /** After the popup says paid: wait (up to ~30 s) for the server to credit the wallet. */
  async function waitForCredit(topupId: string, paid: number, verifyBody: object) {
    setWaiting(true);
    try {
      await api.post('/payments/verify', verifyBody);
    } catch {
      // the status check below also asks the gateway, so this is only the fast path
    }
    for (let i = 0; i < 15; i++) {
      try {
        const status = await api.get<{ status: string }>(`/me/coins/topups/${topupId}`);
        if (status.status === 'SUCCESS') {
          if (mounted.current) {
            setWaiting(false);
            setCredited(paid);
          }
          return;
        }
      } catch {
        // keep trying
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!mounted.current) return;
    setWaiting(false);
    setError('We received your payment and are adding the Coins. They appear in your wallet within a minute; you do not need to pay again.');
    onCredited(paid);
  }

  async function pay() {
    if (problem || busy) return;
    const key = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!key || !window.Razorpay) {
      setError('Online payment is not available right now. Please try again shortly.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await api.post<{ topupId: string; gatewayOrderId: string; amount: number; currency: string }>('/me/coins/topup', { amount });
      const options: RazorpayCheckoutOptions = {
        key,
        amount: Math.round(order.amount * 100),
        currency: order.currency,
        name: 'Bookyo',
        description: 'Add money to your Coins wallet',
        order_id: order.gatewayOrderId,
        handler: (response) =>
          void waitForCredit(order.topupId, order.amount, {
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          }),
        modal: { ondismiss: () => mounted.current && setBusy(false) },
        theme: { color: '#050505' },
      };
      const checkout = new window.Razorpay(options);
      checkout.on('payment.failed', (res) => setError(res.error?.description ?? 'The payment did not go through. You can try again.'));
      checkout.open();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the payment.');
      setBusy(false);
    }
  }

  if (credited !== null) {
    return (
      <PaymentSuccess
        title="Money added"
        amount={formatPrice({ amount: String(credited), currency: 'INR' })}
        detail="Added to your Coins wallet"
        continueLabel="Done"
        onDone={() => {
          onCredited(credited);
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="absolute inset-0 bg-slate-900/50" onMouseDown={() => !busy && !waiting && onClose()} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Add money to wallet" className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Add money to your wallet</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy || waiting} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <Icon name="close" className="text-[1.125rem]" />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">You get the same amount in Coins and can use them to pay for any booking. Added money is spent only on bookings; it is not returned to your card.</p>

        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
          {PRESETS.filter((p) => p >= min && p <= max).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setText(String(p))}
              aria-pressed={amount === p}
              className={`rounded-xl border px-3.5 py-2 text-sm font-bold transition ${amount === p ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}
            >
              {formatPrice({ amount: String(p), currency: 'INR' })}
            </button>
          ))}
        </div>

        <label htmlFor="topup-amount" className="mb-1 block text-sm font-medium text-slate-700">
          Amount
        </label>
        <div className={`flex items-center rounded-xl border bg-white px-3 ${problem && text !== '' ? 'border-red-400' : 'border-slate-200 focus-within:border-brand-700'}`}>
          <span aria-hidden="true" className="pr-1 text-lg font-bold text-slate-500">
            ₹
          </span>
          <input
            id="topup-amount"
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ''))}
            className="h-12 min-w-0 flex-1 bg-transparent text-lg font-bold text-slate-900 focus:outline-none"
            aria-invalid={problem !== null && text !== ''}
            aria-describedby="topup-help"
          />
        </div>
        <p id="topup-help" className={`mt-1.5 min-h-[1.25rem] text-xs ${problem && text !== '' ? 'text-red-600' : 'text-slate-500'}`}>
          {problem && text !== '' ? problem : `Between ${formatPrice({ amount: String(min), currency: 'INR' })} and ${formatPrice({ amount: String(max), currency: 'INR' })}.`}
        </p>

        {error && (
          <div role="alert" className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}
        {waiting && (
          <p role="status" className="mt-3 text-center text-sm font-medium text-slate-700">
            Adding the Coins to your wallet…
          </p>
        )}

        <Button className="mt-4 w-full" disabled={problem !== null || busy || waiting} onClick={() => void pay()}>
          {waiting ? 'Please wait…' : busy ? 'Opening payment…' : problem ? 'Add money' : `Pay ${formatPrice({ amount: String(amount), currency: 'INR' })}`}
        </Button>
      </div>
    </div>
  );
}
