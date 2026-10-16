'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { LoginGate } from '@/components/login-gate';
import { Button, Card, ErrorBanner, Icon, Input, Label, LoadingState, SuccessBanner } from '@/components/ui';
import { Screen } from '@/components/screen';

interface CoinWallet {
  cachedBalance: string;
  currency: string;
}
interface CoinTransaction {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  BOOKING_REWARD: 'Booking reward',
  REFUND: 'Cancellation refund',
  REFERRAL: 'Referral bonus',
  PROMOTION: 'Promotion',
  BOOKING_REDEMPTION: 'Used for a booking',
  ADMIN_ADJUSTMENT: 'Adjustment',
};

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

function Profile() {
  const { customer, refresh } = useCustomer();
  const [name, setName] = useState(customer?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch('/customer-auth/me', { name: name.trim() });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Profile</h2>
      <form onSubmit={onSave} className="space-y-3">
        {error && (
          <div role="alert">
            <ErrorBanner message={error} />
          </div>
        )}
        {saved && <SuccessBanner message="Saved." />}
        <div>
          <Label>Name</Label>
          <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>WhatsApp number</Label>
          <Input readOnly value={customer?.phone ?? ''} className="bg-gray-50 text-gray-500" />
        </div>
        <Button type="submit" disabled={saving || name.trim() === '' || name.trim() === (customer?.name ?? '')}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Card>
  );
}

function Wallet() {
  const { refresh } = useCustomer();
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [txs, setTxs] = useState<CoinTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<CoinWallet>('/me/coins'),
      api.get<CoinTransaction[]>('/me/coins/transactions'),
    ])
      .then(([w, t]) => {
        setWallet(w);
        setTxs(t.slice(0, 20));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Could not load your wallet.');
      });
  }, [refresh]);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Coins wallet</h2>
      {error && <ErrorBanner message={error} />}
      {!error && !wallet && <LoadingState />}
      {wallet && (
        <>
          <p className="text-3xl font-semibold text-gray-900">{wallet.cachedBalance}</p>
          <p className="mb-4 text-xs text-gray-500">Coins from cancelled bookings. Use them to pay for your next one.</p>
          {txs && txs.length === 0 && <p className="text-sm text-gray-500">No transactions yet.</p>}
          {txs && txs.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm">
              {txs.map((t) => {
                const credit = Number(t.amount) >= 0;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-gray-900">{labelFor(t.type)}</p>
                      <p className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</p>
                    </div>
                    <p className={`shrink-0 font-medium ${credit ? 'text-emerald-700' : 'text-gray-900'}`}>
                      {credit ? '+' : ''}
                      {t.amount}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

export default function AccountPage() {
  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="handshake" />
        My account
      </h1>
      <LoginGate message="Log in to see your account.">
        <Profile />
        <Wallet />
      </LoginGate>
    </Screen>
  );
}
