'use client';

import { useFetch } from '@/lib/use-fetch';
import { Card, ErrorBanner, Icon, PageHeader } from '@/components/ui';

interface Summary {
  totalVenues: number;
  activeVenues: number;
  bookingsToday: number;
  revenueThisMonth: string;
}

const CARDS: Array<{
  key: keyof Summary;
  label: string;
  icon: string;
  format?: (v: string | number) => string;
}> = [
  { key: 'totalVenues', label: 'My Venues', icon: 'sports_soccer' },
  { key: 'activeVenues', label: 'Active Venues', icon: 'check_circle' },
  { key: 'bookingsToday', label: 'Bookings Today', icon: 'event' },
  {
    key: 'revenueThisMonth',
    label: 'Revenue This Month',
    icon: 'account_balance_wallet',
    format: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
  },
];

export default function DashboardPage() {
  const { data, error, loading } = useFetch<Summary>('/owner/dashboard/summary');

  return (
    <div>
      <PageHeader title="Dashboard" />
      {loading && (
        <div className="grid grid-cols-2 gap-card-gap sm:grid-cols-4">
          {CARDS.map(({ key }) => (
            <Card key={key} className="h-28 animate-pulse">
              {null}
            </Card>
          ))}
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="grid grid-cols-2 gap-card-gap sm:grid-cols-4">
          {CARDS.map(({ key, label, icon, format }) => (
            <Card
              key={key}
              className="group relative overflow-hidden transition-shadow hover:shadow-md"
            >
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/5 transition-transform duration-500 group-hover:scale-150" />
              <div className="relative z-10 mb-4 flex items-start justify-between">
                <p className="font-label-md text-label-md uppercase text-on-surface-variant">{label}</p>
                <Icon name={icon} className="text-primary" />
              </div>
              <h3 className="relative z-10 font-stat-lg text-stat-lg text-on-surface">
                {format ? format(data[key]) : data[key]}
              </h3>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
