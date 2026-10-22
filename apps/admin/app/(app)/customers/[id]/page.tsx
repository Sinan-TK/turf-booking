'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { hasErrors, numberError, textError, type FieldErrors } from '@/lib/validation';
import { Icon } from '@/components/icons';
import { StatusAction } from '@/components/status-action';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  PageHeader,
  SkeletonDetailCard,
  SkeletonText,
  StatCard,
  SuccessBanner,
  invalidClass,
} from '@/components/ui';

interface CustomerDetail {
  id: string;
  whatsappNumber: string;
  name: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  coinWallet: { cachedBalance: string; currency: string } | null;
  stats: {
    totalBookings: number;
    bookingsByStatus: Record<string, number>;
    totalSpent: string;
    firstBookedAt: string | null;
    lastBookedAt: string | null;
    openTickets: number;
    lastSeenAt: string | null;
  };
  recentBookings: Array<{
    id: string;
    orderId: string;
    status: string;
    amount: string;
    currency: string;
    startTime: string;
    venue: { name: string };
  }>;
  recentTransactions: Array<{
    id: string;
    type: string;
    amount: string;
    balanceAfter: string;
    createdAt: string;
  }>;
}

const QUICK_AMOUNTS = [50, 100, 250, 500];

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, error, loading, refetch, mutate } = useFetch<CustomerDetail>(
    `/admin/customers/${id}`,
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonText className="mb-6 h-6 w-48" />
        <SkeletonDetailCard fields={4} />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!customer) return null;

  const blocked = customer.status === 'BLOCKED';
  const currency = customer.coinWallet?.currency ?? customer.recentBookings[0]?.currency ?? 'INR';

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/customers', label: 'Customers' }}
        title={customer.name || customer.whatsappNumber}
        subtitle={customer.name ? customer.whatsappNumber : undefined}
        action={
          <StatusAction
            path={`/admin/customers/${customer.id}/status`}
            restricted={blocked}
            restrictStatus="BLOCKED"
            restoreStatus="ACTIVE"
            restrictLabel="Block customer"
            restoreLabel="Unblock customer"
            restrictTitle="Block this customer?"
            restrictBody="They will be signed out and unable to log in or book. Existing bookings are not cancelled."
            restoreTitle="Unblock this customer?"
            restoreBody="They will be able to log in and book again."
            confirmRestrict="Block"
            confirmRestore="Unblock"
            onChanged={refetch}
          />
        }
      />

      {blocked && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <Icon name="ban" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This customer is blocked. Their web sessions were signed out and they can&apos;t log in or book until
            you unblock them.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total bookings" value={customer.stats.totalBookings} icon="calendar" />
        <StatCard
          label="Total spent"
          value={`${currency} ${money(Number(customer.stats.totalSpent))}`}
          icon="rupee"
          tone="violet"
        />
        <StatCard label="Last booked" value={date(customer.stats.lastBookedAt)} icon="calendar" tone="sky" />
        <StatCard
          label="Coin balance"
          value={money(Number(customer.coinWallet?.cachedBalance ?? 0))}
          icon="card"
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Profile</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <Detail label="Status">
                <Badge value={customer.status} />
              </Detail>
              <Detail label="WhatsApp number">
                <span className="font-mono">{customer.whatsappNumber}</span>
              </Detail>
              <Detail label="Email">{customer.email || '—'}</Detail>
              <Detail label="Joined">{dateTime(customer.createdAt)}</Detail>
              <Detail label="First booking">{date(customer.stats.firstBookedAt)}</Detail>
              <Detail label="Last active on web">{dateTime(customer.stats.lastSeenAt)}</Detail>
              <Detail label="Open support tickets">
                {customer.stats.openTickets > 0 ? (
                  <Link href="/support" className="font-medium text-brand-700 hover:underline">
                    {customer.stats.openTickets} open
                  </Link>
                ) : (
                  'None'
                )}
              </Detail>
            </dl>
            {customer.stats.totalBookings > 0 && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                {Object.entries(customer.stats.bookingsByStatus).map(([status, n]) => (
                  <span key={status} className="inline-flex items-center gap-2 text-sm text-gray-600">
                    <Badge value={status} />
                    <span className="font-medium text-gray-900">{n}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Recent bookings</h2>
              {customer.stats.totalBookings > customer.recentBookings.length && (
                <span className="text-xs text-gray-500">
                  Latest {customer.recentBookings.length} of {customer.stats.totalBookings}
                </span>
              )}
            </div>
            {customer.recentBookings.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState message="No bookings yet." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-y border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Venue</th>
                      <th className="px-4 py-3">Start</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {customer.recentBookings.map((b) => (
                      <tr key={b.id} className="border-b border-gray-100 last:border-0 hover:bg-brand-50/40">
                        <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
                        <td className="px-4 py-3">{b.venue.name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">{dateTime(b.startTime)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {b.currency} {b.amount}
                        </td>
                        <td className="px-4 py-3">
                          <Badge value={b.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/bookings/${b.id}`} className="font-medium text-gray-900 hover:underline">
                            View →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <WalletCard customer={customer} onChanged={refetch} mutate={mutate} />

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Wallet activity</h2>
            {customer.recentTransactions.length === 0 ? (
              <p className="text-sm text-gray-500">No coin movements yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {customer.recentTransactions.map((t) => {
                  const amount = Number(t.amount);
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{t.type.replace(/_/g, ' ').toLowerCase()}</p>
                        <p className="text-xs text-gray-500">{dateTime(t.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold tabular-nums ${amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {amount >= 0 ? '+' : '−'}
                          {money(Math.abs(amount))}
                        </p>
                        <p className="text-xs text-gray-500">bal {money(Number(t.balanceAfter))}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-gray-900">{children}</dd>
    </div>
  );
}

function WalletCard({
  customer,
  onChanged,
  mutate,
}: {
  customer: CustomerDetail;
  onChanged: () => void;
  mutate: (fn: (prev: CustomerDetail | null) => CustomerDetail | null) => void;
}) {
  const [mode, setMode] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'amount' | 'reason'>>({});

  const balance = Number(customer.coinWallet?.cachedBalance ?? 0);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const delta = mode === 'credit' ? value : -value;
  const overdraw = mode === 'debit' && valid && value > balance;
  const credit = mode === 'credit';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found: FieldErrors<'amount' | 'reason'> = {
      amount:
        numberError(amount, 'Amount', 0.01, 1_000_000) ??
        (overdraw ? `That is more than the wallet holds (${money(balance)}).` : undefined),
      reason: textError(reason, 'Reason', 1, 500),
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.amount ? 'wallet-amount' : 'wallet-reason')?.focus();
      return;
    }
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    // Optimistic: show the new balance at once, roll back if rejected.
    const shift = (by: number) =>
      mutate((prev) =>
        prev?.coinWallet
          ? { ...prev, coinWallet: { ...prev.coinWallet, cachedBalance: String(Number(prev.coinWallet.cachedBalance) + by) } }
          : prev,
      );
    shift(delta);
    try {
      await api.post('/admin/coins/adjust', { customerId: customer.id, signedAmount: delta, reason: reason.trim() });
      setSuccess(`${credit ? 'Credited' : 'Debited'} ${money(value)} coins.`);
      setAmount('');
      setReason('');
      onChanged();
    } catch (err) {
      shift(-delta);
      setError(err instanceof ApiError ? err.message : 'Failed to adjust wallet');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Coin wallet</h2>
          <p className="mt-0.5 text-xs text-gray-500">Every adjustment is recorded in the ledger and audit log.</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Balance</p>
          <p className="text-2xl font-semibold tabular-nums text-gray-900">🪙 {money(balance)}</p>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
        {error && <ErrorBanner message={error} />}
        {success && <SuccessBanner message={success} />}

        <div role="group" aria-label="Adjustment type" className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            aria-pressed={credit}
            onClick={() => setMode('credit')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              credit ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:text-emerald-700'
            }`}
          >
            <Icon name="plus" className="h-4 w-4" />
            Credit
          </button>
          <button
            type="button"
            aria-pressed={!credit}
            onClick={() => setMode('debit')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              !credit ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:text-red-700'
            }`}
          >
            <Icon name="minus" className="h-4 w-4" />
            Debit
          </button>
        </div>

        <div>
          <Label htmlFor="wallet-amount">Amount</Label>
          <Input
            id="wallet-amount"
            aria-invalid={!!errors.amount || overdraw}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setErrors((p) => ({ ...p, amount: undefined }));
            }}
            className={overdraw || errors.amount ? invalidClass : ''}
          />
          <FieldError id="wallet-amount-error" message={errors.amount} />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setAmount(String(q));
                  setErrors((p) => ({ ...p, amount: undefined }));
                }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  credit
                    ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    : 'border-red-200 text-red-700 hover:bg-red-50'
                }`}
              >
                {credit ? '+' : '−'}
                {q}
              </button>
            ))}
          </div>
          {overdraw && (
            <p className="mt-2 text-xs text-red-600">That is more than the wallet holds ({money(balance)}).</p>
          )}
        </div>

        <div>
          <Label htmlFor="wallet-reason">Reason</Label>
          <Input
            id="wallet-reason"
            aria-invalid={!!errors.reason}
            className={errors.reason ? invalidClass : ''}
            maxLength={500}
            placeholder={credit ? 'e.g. Goodwill credit for a cancelled slot' : 'e.g. Correcting a duplicate credit'}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((p) => ({ ...p, reason: undefined }));
            }}
          />
          <FieldError id="wallet-reason-error" message={errors.reason} />
        </div>

        {valid && !overdraw && (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-500">New balance</span>
            <span className="font-semibold tabular-nums text-gray-900">
              {money(balance)}{' '}
              <span className={credit ? 'text-emerald-600' : 'text-red-600'}>
                {credit ? '+' : '−'} {money(value)}
              </span>{' '}
              = 🪙 {money(balance + delta)}
            </span>
          </div>
        )}

        <Button
          type="submit"
          variant={credit ? 'primary' : 'danger'}
          loading={submitting}
          className={`w-full ${credit ? '!bg-emerald-600 hover:!bg-emerald-700 disabled:!bg-emerald-300' : ''}`}
        >
          {submitting ? 'Applying…' : credit ? `Credit ${valid ? money(value) : ''} coins` : `Debit ${valid ? money(value) : ''} coins`}
        </Button>
      </form>
    </Card>
  );
}
