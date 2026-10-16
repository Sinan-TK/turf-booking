'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { LoginGate } from '@/components/login-gate';
import { Badge, Card, ErrorBanner, Icon, LoadingState } from '@/components/ui';
import { Screen } from '@/components/screen';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  groundType: string;
}

function BookingList() {
  const { refresh } = useCustomer();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Booking[]>('/me/bookings')
      .then(setBookings)
      .catch((err) => {
        // An expired session sends the visitor back to the login prompt.
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
  }, [refresh]);

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {!error && !bookings && <LoadingState />}
      {!error && bookings && bookings.length === 0 && (
        <Card>
          <p className="mb-4 text-center text-sm text-gray-500">No bookings yet.</p>
          <Link href="/" className="block text-center text-sm font-medium text-emerald-700 hover:underline">
            Find a venue
          </Link>
        </Card>
      )}
      {!error && bookings && bookings.length > 0 && (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Link key={b.id} href={b.status === 'PENDING_PAYMENT' ? `/checkout/${b.id}` : `/bookings/${b.id}`}>
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
    </>
  );
}

export default function MyBookingsPage() {
  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="schedule" />
        My Bookings
      </h1>
      <LoginGate message="Log in to see your bookings.">
        <BookingList />
      </LoginGate>
    </Screen>
  );
}
