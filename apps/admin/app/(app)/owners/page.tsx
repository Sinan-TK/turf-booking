'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Input,
  Label,
  PageHeader,
  SkeletonTable,
} from '@/components/ui';

interface Organization {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
}

export default function OwnersPage() {
  const { data, error, loading, refetch } = useFetch<Organization[]>('/admin/organizations');
  const [form, setForm] = useState({ name: '', contactEmail: '', contactPhone: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await api.post('/admin/organizations', form);
      setForm({ name: '', contactEmail: '', contactPhone: '' });
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Owner Organizations" />

      <Card className="max-w-xl">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">New Organization</h2>
        <form onSubmit={onSubmit} className="space-y-3">
          {formError && <ErrorBanner message={formError} />}
          <div>
            <Label>Organization Name</Label>
            <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Contact Email</Label>
            <Input
              required
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            />
          </div>
          <div>
            <Label>Contact Phone</Label>
            <Input
              required
              value={form.contactPhone}
              onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
            />
          </div>
          <Button type="submit" loading={submitting}>
            {submitting ? 'Creating…' : 'Create Organization'}
          </Button>
        </form>
      </Card>

      {loading && <SkeletonTable columns={4} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No owner organizations yet." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((org) => (
                <tr key={org.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {org.contactEmail}
                    <br />
                    {org.contactPhone}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={org.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/owners/${org.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
