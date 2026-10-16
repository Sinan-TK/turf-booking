'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { LoginGate } from '@/components/login-gate';
import { Badge, Button, Card, ErrorBanner, Icon, Input, Label, LoadingState, Select, SuccessBanner } from '@/components/ui';
import { Screen } from '@/components/screen';

interface Ticket {
  id: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'BOOKING_ISSUE', label: 'Problem with a booking' },
  { value: 'PAID_BUT_BOOKING_FAILED', label: 'I paid but my booking failed' },
  { value: 'REFUND_ISSUE', label: 'Refund or Coins issue' },
  { value: 'ACCOUNT_PROFILE_ISSUE', label: 'Account or profile' },
  { value: 'OTHER', label: 'Something else' },
];

function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

function Tickets() {
  const { refresh } = useCustomer();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState({ category: 'BOOKING_ISSUE', subject: '', description: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Ticket[]>('/me/support-tickets')
      .then(setTickets)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setListError(err instanceof ApiError ? err.message : 'Could not load your tickets.');
      });
  }, [refresh]);

  useEffect(load, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setFormError(null);
    setSent(false);
    try {
      await api.post('/me/support-tickets', {
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
      });
      setForm({ category: 'BOOKING_ISSUE', subject: '', description: '' });
      setSent(true);
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not send your request.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Card className="mb-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Contact support</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          {formError && (
            <div role="alert">
              <ErrorBanner message={formError} />
            </div>
          )}
          {sent && <SuccessBanner message="Thanks — we have your request and will reply on WhatsApp." />}
          <div>
            <Label>What is it about?</Label>
            <Select
              className="w-full"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Subject</Label>
            <Input
              required
              maxLength={150}
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            />
          </div>
          <div>
            <Label>Details</Label>
            <textarea
              required
              maxLength={2000}
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <Button type="submit" disabled={sending || form.subject.trim() === '' || form.description.trim() === ''}>
            {sending ? 'Sending…' : 'Send request'}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Your requests</h2>
        {listError && <ErrorBanner message={listError} />}
        {!listError && !tickets && <LoadingState />}
        {tickets && tickets.length === 0 && <p className="text-sm text-gray-500">No requests yet.</p>}
        {tickets && tickets.length > 0 && (
          <ul className="divide-y divide-gray-100 text-sm">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{t.subject}</p>
                  <p className="text-xs text-gray-500">
                    {categoryLabel(t.category)} · {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge value={t.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function SupportPage() {
  return (
    <Screen>
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="handshake" />
        Support
      </h1>
      <LoginGate message="Log in to contact support.">
        <Tickets />
      </LoginGate>
    </Screen>
  );
}
