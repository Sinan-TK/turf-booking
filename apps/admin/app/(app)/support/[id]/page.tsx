'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Label,
  PageHeader,
  Select,
  SkeletonDetailCard,
  SkeletonText,
} from '@/components/ui';

interface Message {
  id: string;
  authorType: string;
  body: string;
  createdAt: string;
}
interface Ticket {
  id: string;
  subject: string;
  description: string;
  category: string;
  status: string;
  priority: string;
  customer: { whatsappNumber: string; name: string | null };
  messages: Message[];
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: ticket, error, loading, mutate } = useFetch<Ticket>(`/admin/support-tickets/${id}`);

  const [savingField, setSavingField] = useState<'status' | 'priority' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A message is appended immediately with a temp id, then reconciled
  // (or removed, on failure) once the real request settles.
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);

  async function updateField(field: 'status' | 'priority', value: string) {
    if (!ticket) return;
    const previous = ticket[field];
    setSaveError(null);
    setSavingField(field);
    mutate((prev) => (prev ? { ...prev, [field]: value } : prev));
    try {
      await api.patch(`/admin/support-tickets/${id}`, { [field]: value });
    } catch (err) {
      mutate((prev) => (prev ? { ...prev, [field]: previous } : prev));
      setSaveError(err instanceof ApiError ? err.message : 'Failed to update ticket');
    } finally {
      setSavingField(null);
    }
  }

  async function onReply(e: React.FormEvent) {
    e.preventDefault();
    const body = reply.trim();
    if (!body || !ticket) return;
    setReplyError(null);
    setReplying(true);
    setReply('');

    const optimisticMessage: Message = {
      id: `optimistic-${Date.now()}`,
      authorType: 'ADMIN',
      body,
      createdAt: new Date().toISOString(),
    };
    mutate((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticMessage] } : prev));

    try {
      const saved = await api.post<Message>(`/admin/support-tickets/${id}/messages`, { body });
      mutate((prev) =>
        prev
          ? { ...prev, messages: prev.messages.map((m) => (m.id === optimisticMessage.id ? saved : m)) }
          : prev,
      );
    } catch (err) {
      mutate((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMessage.id) } : prev,
      );
      setReply(body); // give the admin their draft back
      setReplyError(err instanceof ApiError ? err.message : 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonText className="mb-6 h-6 w-64" />
        <SkeletonDetailCard fields={2} />
        <Card>
          <SkeletonText className="mb-4 h-4 w-28" />
          <SkeletonText className="h-16 w-full" />
        </Card>
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!ticket) return null;

  return (
    <div className="space-y-6">
      <PageHeader title={ticket.subject} />

      <Card>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Customer</dt>
            <dd>{ticket.customer.name || ticket.customer.whatsappNumber}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Category</dt>
            <dd>{ticket.category}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-gray-500">Description</dt>
            <dd>{ticket.description}</dd>
          </div>
        </dl>

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
          {saveError && (
            <div className="col-span-2">
              <ErrorBanner message={saveError} />
            </div>
          )}
          <div>
            <Label>
              Status
              {savingField === 'status' && <span className="ml-2 text-gray-400">saving…</span>}
            </Label>
            <Select
              disabled={savingField !== null}
              value={ticket.status}
              onChange={(e) => updateField('status', e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>
              Priority
              {savingField === 'priority' && <span className="ml-2 text-gray-400">saving…</span>}
            </Label>
            <Select
              disabled={savingField !== null}
              value={ticket.priority}
              onChange={(e) => updateField('priority', e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Conversation</h2>
        <div className="mb-4 space-y-3">
          {ticket.messages.length === 0 && <p className="text-sm text-gray-500">No messages yet.</p>}
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md p-3 text-sm transition-opacity ${
                m.authorType === 'ADMIN' ? 'ml-8 bg-brand-600 text-white' : 'mr-8 bg-gray-100 text-gray-900'
              } ${m.id.startsWith('optimistic-') ? 'opacity-60' : ''}`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                <Badge value={m.authorType} />
                <span>{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              {m.body}
            </div>
          ))}
        </div>

        <form onSubmit={onReply} className="border-t border-gray-100 pt-4">
          {replyError && (
            <div className="mb-2">
              <ErrorBanner message={replyError} />
            </div>
          )}
          <textarea
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:border-gray-500 focus:outline-none"
            rows={3}
            placeholder="Reply to the customer…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <Button type="submit" loading={replying} disabled={!reply.trim()}>
            {replying ? 'Sending…' : 'Send Reply'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
