'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { money } from '@/lib/commercial';
import { Badge, Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, SkeletonDetailCard } from '@/components/ui';

interface Settlement {
  id: string;
  kind: 'PLAYED' | 'NO_SHOW' | 'LATE_CANCEL';
  slotStart: string;
  collected: string;
  commission: string;
  fee: string;
  refunded: string;
  ownerAmount: string;
  platformAmount: string;
  booking: { id: string; orderId: string };
  venue: { id: string; name: string };
  category: { id: string; name: string };
}

interface PayoutDetail {
  id: string;
  organization: { id: string; name: string };
  periodEnd: string;
  totalOwnerAmount: string;
  settlementCount: number;
  status: 'PENDING' | 'PAID';
  reference: string | null;
  paidAt: string | null;
  settlements: Settlement[];
}

const KIND: Record<Settlement['kind'], string> = { PLAYED: 'Played', NO_SHOW: 'No-show', LATE_CANCEL: 'Late cancellation' };

export default function PayoutDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, refetch } = useFetch<PayoutDetail>(`/admin/payouts/${id}`);
  const [reference, setReference] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [apiError, setApiError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <SkeletonDetailCard fields={5} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  async function markPaid() {
    if (reference.trim().length < 3) {
      setFieldError('Enter the bank transfer reference (UTR).');
      return;
    }
    setFieldError(undefined);
    setApiError(null);
    setSaving(true);
    try {
      await api.post(`/admin/payouts/${id}/mark-paid`, { reference: reference.trim() });
      refetch();
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Could not mark as paid');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/payouts" className="inline-block text-sm text-gray-500 hover:text-gray-800">
        ← Payouts
      </Link>
      <PageHeader
        title={`${data.organization.name} · ${money(data.totalOwnerAmount)}`}
        subtitle={`${data.settlementCount} booking${data.settlementCount === 1 ? '' : 's'} with slots before ${new Date(data.periodEnd).toLocaleDateString('en-IN', { dateStyle: 'long' })}.`}
      />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge value={data.status} />
            {data.status === 'PAID' && (
              <p className="mt-2 text-sm text-gray-600">
                Paid {data.paidAt ? new Date(data.paidAt).toLocaleString('en-IN') : ''} · reference <span className="font-mono">{data.reference}</span>
              </p>
            )}
          </div>
          {data.status === 'PENDING' && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="utr">Bank transfer reference (UTR)</Label>
                <Input
                  id="utr"
                  value={reference}
                  onChange={(e) => {
                    setReference(e.target.value);
                    setFieldError(undefined);
                  }}
                  aria-invalid={!!fieldError}
                  className={fieldError ? '!border-red-500' : ''}
                />
                <FieldError id="utr-error" message={fieldError} />
              </div>
              <Button type="button" onClick={markPaid} loading={saving}>
                Mark as paid
              </Button>
            </div>
          )}
        </div>
        {apiError && (
          <div className="mt-4">
            <ErrorBanner message={apiError} />
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Venue · facility</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Paid online</th>
              <th className="px-4 py-3">Commission &amp; fee</th>
              <th className="px-4 py-3">Coins back</th>
              <th className="px-4 py-3">Owner</th>
            </tr>
          </thead>
          <tbody>
            {data.settlements.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-600">{new Date(s.slotStart).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td className="px-4 py-3">
                  <Link href={`/bookings/${s.booking.id}`} className="font-mono text-xs hover:underline">
                    {s.booking.orderId}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {s.venue.name} · {s.category.name}
                </td>
                <td className="px-4 py-3">{KIND[s.kind]}</td>
                <td className="px-4 py-3">{money(s.collected)}</td>
                <td className="px-4 py-3">{money(Number(s.commission) + Number(s.fee))}</td>
                <td className="px-4 py-3">{money(s.refunded)}</td>
                <td className="px-4 py-3 font-medium">{money(s.ownerAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
