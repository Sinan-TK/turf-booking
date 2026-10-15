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
  Input,
  Label,
  PageHeader,
  Select,
  SkeletonDetailCard,
  SkeletonText,
  SuccessBanner,
} from '@/components/ui';

interface Organization {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
}

interface OwnerUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export default function OwnerOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: org, error, loading } = useFetch<Organization>(`/admin/organizations/${id}`);
  const {
    data: ownerUsers,
    error: usersError,
    refetch: refetchUsers,
  } = useFetch<OwnerUser[]>(`/admin/organizations/${id}/owner-users`);

  const [form, setForm] = useState({ email: '', name: '', phone: '', role: 'OWNER_ADMIN' });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);
    try {
      await api.post(`/admin/organizations/${id}/owner-users`, {
        ...form,
        phone: form.phone || undefined,
      });
      setForm({ email: '', name: '', phone: '', role: 'OWNER_ADMIN' });
      setFormSuccess(`Invited ${form.email} — they'll get an email to set their password.`);
      refetchUsers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create owner user');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonText className="mb-6 h-6 w-48" />
        <SkeletonDetailCard fields={2} />
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!org) return null;

  return (
    <div className="space-y-6">
      <PageHeader title={org.name} />

      <Card>
        <div className="mb-2">
          <Badge value={org.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Contact Email</dt>
            <dd>{org.contactEmail}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Contact Phone</dt>
            <dd>{org.contactPhone}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Owner Logins</h2>
        {usersError && <ErrorBanner message={usersError} />}
        {!ownerUsers && !usersError && (
          <div className="mb-6 space-y-2">
            <SkeletonText className="h-8 w-full" />
            <SkeletonText className="h-8 w-full" />
          </div>
        )}
        {ownerUsers && ownerUsers.length > 0 ? (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Invited</th>
                </tr>
              </thead>
              <tbody>
                {ownerUsers.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                    <td className="py-2 font-medium">{u.name}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.role}</td>
                    <td className="py-2">
                      <Badge value={u.status} />
                    </td>
                    <td className="py-2 text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          ownerUsers && <p className="mb-6 text-sm text-gray-500">No owner logins yet.</p>
        )}

        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
          {formError && (
            <div className="col-span-2">
              <ErrorBanner message={formError} />
            </div>
          )}
          {formSuccess && (
            <div className="col-span-2">
              <SuccessBanner message={formSuccess} />
            </div>
          )}
          <div>
            <Label>Name</Label>
            <Input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <Label>Phone (optional)</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="OWNER_ADMIN">OWNER_ADMIN</option>
              <option value="OWNER_STAFF">OWNER_STAFF</option>
            </Select>
          </div>
          <p className="col-span-2 -mt-1 text-xs text-gray-500">
            No password to set here — they get an email with a link to choose their own.
          </p>
          <div className="col-span-2">
            <Button type="submit" loading={submitting}>
              {submitting ? 'Inviting…' : 'Invite Owner'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
