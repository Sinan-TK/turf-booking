'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Badge, Card, ErrorBanner, Icon, LoadingState, Screen } from '@/components/ui';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  groundType: string;
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Booking[]>('/me/bookings')
      .then(setBookings)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 401
            ? "Your session has expired — open your booking link from WhatsApp again, or send 'Hi' for a new one."
            : err instanceof ApiError
              ? err.message
              : 'Something went wrong.',
        );
      });
  }, []);

  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="event_note" />
        My Bookings
      </h1>
      {error && <ErrorBanner message={error} />}
      {!error && !bookings && <LoadingState />}
      {!error && bookings && bookings.length === 0 && (
        <Card>
          <p className="text-center text-sm text-gray-500">No bookings yet.</p>
        </Card>
      )}
      {!error && bookings && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{b.orderId}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(b.startTime).toLocaleString()} · {b.groundType}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {b.currency} {b.amount}
                    </p>
                    <Badge value={b.status} />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Screen>
  );
}
