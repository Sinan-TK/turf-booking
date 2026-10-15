'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, Input, Label, PageHeader, Select, SuccessBanner } from '@/components/ui';

interface Recipient {
  id: string;
  name: string;
  email: string;
  organizationName: string;
}

export default function AnnouncementsPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'ADMIN_ANNOUNCEMENT' | 'ADMIN_WARNING'>('ADMIN_ANNOUNCEMENT');
  const [recipientType, setRecipientType] = useState<'ALL' | 'SELECTED'>('ALL');
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: recipients } = useFetch<Recipient[]>(
    recipientType === 'SELECTED' ? '/admin/notifications/recipients' : null,
  );

  function toggleOwner(id: string) {
    setSelectedOwnerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ recipientCount: number }>('/admin/notifications', {
        title,
        message,
        type,
        recipientType,
        ownerIds: recipientType === 'SELECTED' ? selectedOwnerIds : undefined,
      });
      setSuccess(`Sent to ${res.recipientCount} owner${res.recipientCount === 1 ? '' : 's'}.`);
      setTitle('');
      setMessage('');
      setSelectedOwnerIds([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send announcement');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Announcements" />
      <Card className="max-w-2xl">
        <p className="mb-4 text-xs text-gray-500">
          Sends a persistent notification into the Owner Portal's notification center — not an email or
          WhatsApp message.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}
          {success && <SuccessBanner message={success} />}

          <div>
            <Label>Title</Label>
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
          </div>

          <div>
            <Label>Message</Label>
            <textarea
              required
              rows={4}
              maxLength={2000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div>
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="ADMIN_ANNOUNCEMENT">Announcement</option>
              <option value="ADMIN_WARNING">Warning</option>
            </Select>
          </div>

          <div>
            <Label>Recipients</Label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={recipientType === 'ALL'}
                  onChange={() => setRecipientType('ALL')}
                />
                All Owners
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={recipientType === 'SELECTED'}
                  onChange={() => setRecipientType('SELECTED')}
                />
                Selected Owners
              </label>
            </div>
          </div>

          {recipientType === 'SELECTED' && (
            <div className="max-h-64 overflow-y-auto rounded-md border border-gray-200 p-3">
              {!recipients && <p className="text-sm text-gray-500">Loading owners…</p>}
              {recipients?.length === 0 && <p className="text-sm text-gray-500">No owners found.</p>}
              {recipients?.map((r) => (
                <label key={r.id} className="mb-1 flex items-center gap-2 text-sm last:mb-0">
                  <input
                    type="checkbox"
                    checked={selectedOwnerIds.includes(r.id)}
                    onChange={() => toggleOwner(r.id)}
                  />
                  <span className="font-medium text-gray-900">{r.name}</span>
                  <span className="text-gray-500">
                    ({r.email} · {r.organizationName})
                  </span>
                </label>
              ))}
            </div>
          )}

          <Button
            type="submit"
            loading={submitting}
            disabled={recipientType === 'SELECTED' && selectedOwnerIds.length === 0}
          >
            {submitting ? 'Sending…' : 'Send Announcement'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
