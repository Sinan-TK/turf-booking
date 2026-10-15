'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  Label,
  PageHeader,
  SkeletonDetailCard,
  SkeletonText,
  SuccessBanner,
} from '@/components/ui';

interface CustomerDetail {
  id: string;
  whatsappNumber: string;
  name: string | null;
  email: string | null;
  status: string;
  createdAt: string;
  coinWallet: { cachedBalance: string; currency: string } | null;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, error, loading, refetch, mutate } = useFetch<CustomerDetail>(
    `/admin/customers/${id}`,
  );

  const [signedAmount, setSignedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    const delta = Number(signedAmount);
    setAdjustError(null);
    setAdjustSuccess(null);
    setSubmitting(true);
    // Optimistic: reflect the new balance the instant the admin submits
    // rather than waiting on the round trip; rolled back below if the
    // adjustment is rejected (e.g. would take the wallet negative).
    mutate((prev) =>
      prev?.coinWallet
        ? { ...prev, coinWallet: { ...prev.coinWallet, cachedBalance: String(Number(prev.coinWallet.cachedBalance) + delta) } }
        : prev,
    );
    try {
      await api.post('/admin/coins/adjust', { customerId: id, signedAmount: delta, reason });
      setSignedAmount('');
      setReason('');
      setAdjustSuccess('Wallet adjusted successfully.');
      refetch();
    } catch (err) {
      mutate((prev) =>
        prev?.coinWallet
          ? { ...prev, coinWallet: { ...prev.coinWallet, cachedBalance: String(Number(prev.coinWallet.cachedBalance) - delta) } }
          : prev,
      );
      setAdjustError(err instanceof ApiError ? err.message : 'Failed to adjust wallet');
    } finally {
      setSubmitting(false);
    }
  }

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

  return (
    <div className="space-y-6">
      <PageHeader title={customer.name || customer.whatsappNumber} />

      <Card>
        <div className="mb-2">
          <Badge value={customer.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">WhatsApp Number</dt>
            <dd className="font-mono">{customer.whatsappNumber}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Email</dt>
            <dd>{customer.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Joined</dt>
            <dd>{new Date(customer.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Coin Balance</dt>
            <dd className="text-lg font-semibold">🪙 {customer.coinWallet?.cachedBalance ?? '0'}</dd>
          </div>
        </dl>
      </Card>

      <Card className="max-w-lg">
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Adjust Coin Wallet</h2>
        <p className="mb-4 text-xs text-gray-500">
          Positive credits, negative debits. This is the only coin-mutating action an admin can take
          directly — every adjustment is recorded in the ledger and audit log.
        </p>
        <form onSubmit={onAdjust} className="space-y-3">
          {adjustError && <ErrorBanner message={adjustError} />}
          {adjustSuccess && <SuccessBanner message={adjustSuccess} />}
          <div>
            <Label>Signed Amount (e.g. 100 or -50)</Label>
            <Input
              required
              type="number"
              step="0.01"
              value={signedAmount}
              onChange={(e) => setSignedAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Reason</Label>
            <Input required value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" loading={submitting}>
            {submitting ? 'Adjusting…' : 'Apply Adjustment'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
