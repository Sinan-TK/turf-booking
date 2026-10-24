'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  LoadingState,
  Select,
  invalidClass,
} from '@/components/ui';
import { hasErrors, type FieldErrors } from '@/lib/validation';

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

/** Contact form and the customer's earlier requests. Shown as a tab on the account page. */
export function SupportPanel() {
  const { refresh } = useCustomer();
  const toast = useToast();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [form, setForm] = useState({ category: 'BOOKING_ISSUE', subject: '', description: '' });
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'subject' | 'description'>>({});

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
    const found: FieldErrors<'subject' | 'description'> = {
      subject: form.subject.trim() ? undefined : 'Enter a subject.',
      description: form.description.trim() ? undefined : 'Tell us what happened.',
    };
    setErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.subject ? 'support-subject' : 'support-description')?.focus();
      return;
    }
    setSending(true);
    setFormError(null);
    try {
      await api.post('/me/support-tickets', {
        category: form.category,
        subject: form.subject.trim(),
        description: form.description.trim(),
      });
      setForm({ category: 'BOOKING_ISSUE', subject: '', description: '' });
      setErrors({});
      toast.show('Thanks, we have your request and will reply soon.');
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
        <form onSubmit={onSubmit} noValidate className="space-y-3">
          {formError && (
            <div role="alert">
              <ErrorBanner message={formError} />
            </div>
          )}
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
            <Label htmlFor="support-subject">Subject</Label>
            <Input
              id="support-subject"
              maxLength={150}
              value={form.subject}
              aria-invalid={!!errors.subject}
              aria-describedby={errors.subject ? 'support-subject-error' : undefined}
              className={errors.subject ? invalidClass : ''}
              onChange={(e) => {
                setForm((f) => ({ ...f, subject: e.target.value }));
                setErrors((p) => ({ ...p, subject: undefined }));
              }}
            />
            <FieldError id="support-subject-error" message={errors.subject} />
          </div>
          <div>
            <Label htmlFor="support-description">Details</Label>
            <textarea
              id="support-description"
              maxLength={2000}
              rows={4}
              value={form.description}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? 'support-description-error' : undefined}
              onChange={(e) => {
                setForm((f) => ({ ...f, description: e.target.value }));
                setErrors((p) => ({ ...p, description: undefined }));
              }}
              className={`w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none ${errors.description ? invalidClass : ''}`}
            />
            <FieldError id="support-description-error" message={errors.description} />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={sending}>
              {sending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
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
