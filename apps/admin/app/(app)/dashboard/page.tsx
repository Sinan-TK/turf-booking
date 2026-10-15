'use client';

import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Icon, type IconName } from '@/components/icons';
import { Card, ErrorBanner, PageHeader, SkeletonStatGrid, StatCard } from '@/components/ui';

interface Summary {
  totalOrganizations: number;
  totalVenues: number;
  activeVenues: number;
  totalCustomers: number;
  bookingsToday: number;
  openSupportTickets: number;
  revenueThisMonth: string;
}

const CARDS: Array<{
  key: keyof Summary;
  label: string;
  icon: IconName;
  tone: 'brand' | 'sky' | 'amber' | 'violet';
  format?: (v: string | number) => string;
}> = [
  {
    key: 'revenueThisMonth',
    label: 'Revenue this month',
    icon: 'rupee',
    tone: 'brand',
    format: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
  },
  { key: 'bookingsToday', label: 'Bookings today', icon: 'calendar', tone: 'sky' },
  { key: 'openSupportTickets', label: 'Open support tickets', icon: 'support', tone: 'amber' },
  { key: 'totalCustomers', label: 'Customers', icon: 'users', tone: 'violet' },
  { key: 'totalOrganizations', label: 'Owner organizations', icon: 'building', tone: 'sky' },
  { key: 'totalVenues', label: 'Total venues', icon: 'venue', tone: 'brand' },
  { key: 'activeVenues', label: 'Active venues', icon: 'check', tone: 'brand' },
];

const SHORTCUTS: Array<{ href: string; label: string; hint: string; icon: IconName }> = [
  { href: '/venue-types/new', label: 'New venue type', hint: 'Add Chess, Badminton…', icon: 'tag' },
  { href: '/venues/new', label: 'New venue', hint: 'Onboard a venue', icon: 'venue' },
  { href: '/bookings', label: 'Bookings', hint: 'See what is booked', icon: 'calendar' },
  { href: '/support', label: 'Support', hint: 'Answer open tickets', icon: 'support' },
];

export default function DashboardPage() {
  const { data, error, loading } = useFetch<Summary>('/admin/dashboard/summary');

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="A live look at the whole platform." />
      {loading && <SkeletonStatGrid count={CARDS.length} />}
      {error && <ErrorBanner message={error} />}
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ key, label, icon, tone, format }, i) => (
            <div key={key} style={{ animationDelay: `${i * 40}ms` }} className="animate-[rise_0.3s_ease-out_both]">
              <StatCard
                label={label}
                icon={icon}
                tone={tone}
                value={format ? format(data[key]) : data[key]}
              />
            </div>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-10 text-sm font-semibold text-gray-900">Quick actions</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SHORTCUTS.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="flex items-center gap-3 p-4 transition group-hover:border-brand-300 group-hover:shadow-pop">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600">
                <Icon name={s.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900">{s.label}</span>
                <span className="block truncate text-xs text-gray-500">{s.hint}</span>
              </span>
              <Icon
                name="arrow"
                className="h-4 w-4 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600"
              />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
