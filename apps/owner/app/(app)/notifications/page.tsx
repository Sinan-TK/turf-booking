'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { useUnreadNotificationCount } from '@/lib/use-unread-notifications';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
} from '@/components/ui';
import { FilterSelect, ListToolbar, SearchBox } from '@/components/list-kit';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  data: { bookingId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'BOOKING_CREATED', label: 'New booking' },
  { value: 'BOOKING_CONFIRMED', label: 'Confirmed' },
  { value: 'BOOKING_CANCELLED', label: 'Cancelled' },
  { value: 'PAYMENT_RECEIVED', label: 'Payment received' },
  { value: 'PAYMENT_FAILED', label: 'Payment failed' },
  { value: 'ADMIN_ANNOUNCEMENT', label: 'Announcement' },
  { value: 'ADMIN_WARNING', label: 'Warning' },
];

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { mutate: mutateCount, refetch: refetchCount } = useUnreadNotificationCount();

  const { data, error, loading } = useFetch<{
    items: NotificationItem[];
    nextCursor: string | null;
  }>('/owner/notifications?limit=20');

  // First page comes from useFetch; "Load more" pages are appended
  // manually below (useFetch has no built-in pagination concept — this
  // mirrors the cursor shape the backend returns).
  useEffect(() => {
    if (data && !initialized) {
      setItems(data.items);
      setCursor(data.nextCursor ?? undefined);
      setInitialized(true);
    }
  }, [data, initialized]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const next = await api.get<{ items: NotificationItem[]; nextCursor: string | null }>(
        `/owner/notifications?limit=20&cursor=${cursor}`,
      );
      setItems((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor ?? undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(n: NotificationItem) {
    if (n.readAt) return;
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    mutateCount((prev) => (prev ? { count: Math.max(0, prev.count - 1) } : prev));
    await api.patch(`/owner/notifications/${n.id}/read`).catch(() => undefined);
    refetchCount();
  }

  async function onNotificationClick(n: NotificationItem) {
    await markRead(n);
    if (n.data?.bookingId) router.push(`/bookings/${n.data.bookingId}`);
  }

  async function onMarkAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    mutateCount(() => ({ count: 0 }));
    await api.patch('/owner/notifications/read-all').catch(() => undefined);
    refetchCount();
  }

  const unread = items.filter((n) => !n.readAt).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      if (unreadOnly && n.readAt) return false;
      if (type && n.type !== type) return false;
      return !q || n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q);
    });
  }, [items, search, type, unreadOnly]);
  const filtering = search !== '' || type !== '' || unreadOnly;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Bookings, payments and messages from the platform."
        action={
          items.length > 0 ? (
            <Button variant="secondary" onClick={onMarkAllRead}>
              Mark all as read
            </Button>
          ) : undefined
        }
      />
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {initialized && items.length === 0 && <EmptyState message="No notifications yet." />}
      {items.length > 0 && (
        <ListToolbar
          active={filtering}
          total={visible.length}
          noun="notification"
          onClear={() => {
            setSearch('');
            setType('');
            setUnreadOnly(false);
          }}
          search={
            <SearchBox
              label="Search notifications"
              placeholder="Search notifications…"
              value={search}
              onChange={setSearch}
            />
          }
        >
          <div
            role="tablist"
            aria-label="Show"
            className="inline-flex h-10 shrink-0 rounded-lg bg-surface-container p-1 text-body-md"
          >
            {[
              { label: 'All', value: false },
              { label: `Unread${unread ? ` (${unread})` : ''}`, value: true },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={unreadOnly === t.value}
                onClick={() => setUnreadOnly(t.value)}
                className={`rounded-md px-3 font-medium transition-colors ${
                  unreadOnly === t.value
                    ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <FilterSelect label="Type" value={type} options={TYPE_OPTIONS} onChange={setType} />
        </ListToolbar>
      )}
      {items.length > 0 && visible.length === 0 && (
        <EmptyState
          message={
            cursor
              ? 'Nothing matches in the notifications loaded so far. Load more to search further back.'
              : 'No notifications match your filters.'
          }
        />
      )}
      {visible.length > 0 && (
        <div className="space-y-2">
          {visible.map((n) => (
            <Card
              key={n.id}
              className={`cursor-pointer transition-shadow hover:shadow-md ${!n.readAt ? 'bg-primary/5' : ''}`}
            >
              <button
                type="button"
                onClick={() => onNotificationClick(n)}
                className="flex w-full items-start gap-3 text-left"
              >
                {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className={!n.readAt ? 'flex-1' : 'ml-4 flex-1'}>
                  <div className="mb-1 flex items-center gap-2">
                    <p className="text-body-md font-semibold text-on-surface">{n.title}</p>
                    <Badge value={n.type} />
                  </div>
                  <p className="text-body-md text-on-surface-variant">{n.message}</p>
                  <p className="mt-1 font-label-md text-label-md text-on-surface-variant/70">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}
      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
