'use client';

import { useMemo, useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, FieldError, Input, Label, PageHeader, Select, SuccessBanner, invalidClass } from '@/components/ui';
import { hasErrors, textError, type FieldErrors } from '@/lib/validation';
import { Pagination, usePageSlice } from '@/components/pagination';

interface Recipient {
  id: string;
  name: string;
  email: string;
  organizationName: string;
}

const RECIPIENT_PAGE = 20;

export default function AnnouncementsPage() {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'ADMIN_ANNOUNCEMENT' | 'ADMIN_WARNING'>('ADMIN_ANNOUNCEMENT');
  const [recipientType, setRecipientType] = useState<'ALL' | 'SELECTED'>('ALL');
  const [selectedOwnerIds, setSelectedOwnerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'title' | 'message' | 'owners'>>({});
  const clear = (k: 'title' | 'message' | 'owners') => setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));

  const { data: recipients } = useFetch<Recipient[]>(
    recipientType === 'SELECTED' ? '/admin/notifications/recipients' : null,
  );

  // Every owner can be chosen, so the list is long: searched and paged here (a choice survives paging and searching).
  const [recipientSearch, setRecipientSearch] = useState('');
  const matchingRecipients = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    return (recipients ?? []).filter((r) => !q || [r.name, r.email, r.organizationName].some((t) => t.toLowerCase().includes(q)));
  }, [recipients, recipientSearch]);
  const recipientPage = usePageSlice(matchingRecipients, RECIPIENT_PAGE, recipientSearch);

  function toggleOwner(id: string) {
    clear('owners');
    setSelectedOwnerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const found: FieldErrors<'title' | 'message' | 'owners'> = {
      title: textError(title, 'Title', 1, 150),
      message: textError(message, 'Message', 1, 2000),
      owners: recipientType === 'SELECTED' && selectedOwnerIds.length === 0 ? 'Choose at least one owner, or send to all owners.' : undefined,
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['title', 'message', 'owners'] as const).find((k) => found[k]);
      document.getElementById('announce-' + first)?.focus();
      return;
    }
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
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <ErrorBanner message={error} />}
          {success && <SuccessBanner message={success} />}

          <div>
            <Label htmlFor="announce-title">Title</Label>
            <Input
              id="announce-title"
              value={title}
              aria-invalid={!!errors.title}
              aria-describedby={errors.title ? 'announce-title-error' : undefined}
              className={errors.title ? invalidClass : ''}
              onChange={(e) => {
                setTitle(e.target.value);
                clear('title');
              }}
            />
            <FieldError id="announce-title-error" message={errors.title} />
          </div>

          <div>
            <Label htmlFor="announce-message">Message</Label>
            <textarea
              id="announce-message"
              rows={4}
              aria-invalid={!!errors.message}
              aria-describedby={errors.message ? 'announce-message-error' : undefined}
              className={`w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none ${errors.message ? invalidClass : ''}`}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                clear('message');
              }}
            />
            <FieldError id="announce-message-error" message={errors.message} />
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
                  onChange={() => {
                    setRecipientType('ALL');
                    clear('owners');
                  }}
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
            <div>
            {recipients && recipients.length > RECIPIENT_PAGE && (
              <div className="mb-2 max-w-md">
                <Input
                  aria-label="Search owners"
                  placeholder="Search name, email or organization…"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.preventDefault(); // searching must not send the announcement
                  }}
                />
              </div>
            )}
            <div
              id="announce-owners"
              tabIndex={-1}
              aria-invalid={!!errors.owners}
              className={`max-h-64 overflow-y-auto rounded-md border p-3 ${errors.owners ? 'border-red-500' : 'border-gray-200'}`}
            >
              {!recipients && <p className="text-sm text-gray-500">Loading owners…</p>}
              {recipients?.length === 0 && <p className="text-sm text-gray-500">No owners found.</p>}
              {recipients && recipients.length > 0 && matchingRecipients.length === 0 && <p className="text-sm text-gray-500">No owners match your search.</p>}
              {recipientPage.rows.map((r) => (
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
            <Pagination page={recipientPage.page} pageSize={RECIPIENT_PAGE} total={recipientPage.total} onPage={recipientPage.setPage} />
            {selectedOwnerIds.length > 0 && <p className="mt-1 text-xs text-gray-500">{selectedOwnerIds.length} owner{selectedOwnerIds.length === 1 ? '' : 's'} chosen.</p>}
            <FieldError id="announce-owners-error" message={errors.owners} />
            </div>
          )}

          <Button type="submit" loading={submitting}>
            {submitting ? 'Sending…' : 'Send Announcement'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
