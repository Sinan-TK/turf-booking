'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { useUnreadNotificationCount } from '@/lib/use-unread-notifications';
import { Icon } from './ui';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  data: { bookingId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { count, refetch: refetchCount, mutate: mutateCount } = useUnreadNotificationCount();
  const { data, refetch, mutate } = useFetch<{ items: NotificationItem[] }>(
    open ? '/owner/notifications?limit=8' : null,
  );

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function markRead(id: string) {
    mutate((prev) =>
      prev ? { items: prev.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) } : prev,
    );
    mutateCount((prev) => (prev ? { count: Math.max(0, prev.count - 1) } : prev));
    await api.patch(`/owner/notifications/${id}/read`).catch(() => undefined);
    refetchCount();
  }

  async function onNotificationClick(n: NotificationItem) {
    if (!n.readAt) await markRead(n.id);
    if (n.data?.bookingId) {
      setOpen(false);
      router.push(`/bookings/${n.data.bookingId}`);
    }
  }

  async function onMarkAllRead() {
    mutate((prev) => (prev ? { items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) } : prev));
    mutateCount(() => ({ count: 0 }));
    await api.patch('/owner/notifications/read-all').catch(() => undefined);
    refetchCount();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) refetch();
        }}
        className="relative rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container"
        aria-label="Notifications"
      >
        <Icon name="notifications" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-surface-container-lowest p-2 shadow-sm ring-1 ring-outline-variant/20">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="font-label-md text-label-md uppercase text-on-surface-variant">Notifications</p>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data && <p className="px-2 py-4 text-center text-body-md text-on-surface-variant">Loading…</p>}
            {data && data.items.length === 0 && (
              <p className="px-2 py-4 text-center text-body-md text-on-surface-variant">No notifications yet.</p>
            )}
            {data?.items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onNotificationClick(n)}
                className={`flex w-full gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-container ${
                  !n.readAt ? 'bg-primary/5' : ''
                }`}
              >
                {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className={!n.readAt ? '' : 'ml-4'}>
                  <p className="text-body-md font-semibold text-on-surface">{n.title}</p>
                  <p className="text-body-md text-on-surface-variant">{n.message}</p>
                  <p className="mt-0.5 font-label-md text-label-md text-on-surface-variant/70">
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-outline-variant/20 px-2 pt-2">
            <button
              type="button"
              onClick={onMarkAllRead}
              className="font-label-md text-label-md text-primary hover:underline"
            >
              Mark all as read
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push('/notifications');
              }}
              className="font-label-md text-label-md text-primary hover:underline"
            >
              View all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
