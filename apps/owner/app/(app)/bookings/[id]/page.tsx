'use client';

import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, ErrorBanner, LoadingState, PageHeader } from '@/components/ui';

interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
}
interface Refund {
  id: string;
  status: string;
  coinAmountCredited: string;
  createdAt: string;
}
interface BookingDetail {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  endTime: string;
  groundType: string;
  paymentMethod: string | null;
  cancellationReasonCode: string | null;
  cancellationNote: string | null;
  venue: { name: string; facilityCode: string };
  customer: { whatsappNumber: string; name: string | null };
  payments: Payment[];
  refunds: Refund[];
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: booking, error, loading } = useFetch<BookingDetail>(`/owner/bookings/${id}`);

  if (loading) return <LoadingState />;
  if (error) return <ErrorBanner message={error} />;
  if (!booking) return null;

  return (
    <div className="space-y-6">
      <PageHeader title={`Booking ${booking.orderId}`} />

      <Card>
        <div className="mb-4">
          <Badge value={booking.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-on-surface-variant">Venue</dt>
            <dd>
              {booking.venue.name} ({booking.venue.facilityCode})
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Customer</dt>
            <dd>{booking.customer.name || booking.customer.whatsappNumber}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Time</dt>
            <dd>
              {new Date(booking.startTime).toLocaleString()} – {new Date(booking.endTime).toLocaleTimeString()}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Ground Type</dt>
            <dd>{booking.groundType}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Amount</dt>
            <dd>
              {booking.currency} {booking.amount}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Payment Method</dt>
            <dd>{booking.paymentMethod || '—'}</dd>
          </div>
          {booking.cancellationReasonCode && (
            <div className="col-span-2">
              <dt className="text-on-surface-variant">Cancellation</dt>
              <dd>
                {booking.cancellationReasonCode}
                {booking.cancellationNote ? ` — ${booking.cancellationNote}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-on-surface">Payments</h2>
        {booking.payments.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {booking.payments.map((p) => (
                  <tr key={p.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">{p.provider}</td>
                    <td className="py-2">
                      {p.currency} {p.amount}
                    </td>
                    <td className="py-2">
                      <Badge value={p.status} />
                    </td>
                    <td className="py-2 text-on-surface-variant">{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-on-surface">Refunds</h2>
        {booking.refunds.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No refunds.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {booking.refunds.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">🪙 {r.coinAmountCredited} Coins</td>
                    <td className="py-2">
                      <Badge value={r.status} />
                    </td>
                    <td className="py-2 text-on-surface-variant">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
