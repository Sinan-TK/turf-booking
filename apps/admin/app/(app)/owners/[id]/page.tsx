'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/icons';
import { StatusAction } from '@/components/status-action';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  SkeletonDetailCard,
  SkeletonText,
  StatCard,
  SuccessBanner,
  invalidClass,
} from '@/components/ui';
import { emailError, hasErrors, phoneError, textError, type FieldErrors } from '@/lib/validation';

interface Organization {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
  createdAt: string;
  stats: {
    venues: number;
    activeVenues: number;
    logins: { total: number; active: number };
    totalBookings: number;
    bookingsByStatus: Record<string, number>;
    revenue: string;
    lastBookedAt: string | null;
  };
  venues: Array<{ id: string; name: string; facilityCode: string; status: string; facilities: Array<{ id: string; name: string }> }>;
  recentBookings: Array<{
    id: string;
    orderId: string;
    status: string;
    amount: string;
    currency: string;
    startTime: string;
    venue: { name: string };
    customer: { name: string | null; whatsappNumber: string | null; email: string | null };
  }>;
}

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

interface OwnerUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string;
  /** Staff only: the venues they work in (an owner admin reaches every venue). */
  venueIds: string[];
}

export default function OwnerOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: org, error, loading, refetch } = useFetch<Organization>(`/admin/organizations/${id}`);
  const {
    data: ownerUsers,
    error: usersError,
    refetch: refetchUsers,
  } = useFetch<OwnerUser[]>(`/admin/organizations/${id}/owner-users`);

  const [form, setForm] = useState({ email: '', name: '', phone: '', role: 'OWNER_ADMIN' });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email' | 'phone' | 'venues'>>({});
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const edit = (k: 'name' | 'email' | 'phone' | 'role', v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k !== 'role') setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const found: FieldErrors<'name' | 'email' | 'phone' | 'venues'> = {
      name: textError(form.name, 'Name', 1, 150),
      email: emailError(form.email, 'their email address'),
      phone: phoneError(form.phone, 'their phone number', false),
      venues: form.role === 'OWNER_STAFF' && venueIds.length === 0 ? 'Choose at least one venue for staff.' : undefined,
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['name', 'email', 'phone'] as const).find((k) => found[k]);
      document.getElementById('invite-' + first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/admin/organizations/${id}/owner-users`, {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        venueIds: form.role === 'OWNER_STAFF' ? venueIds : undefined,
      });
      setForm({ email: '', name: '', phone: '', role: 'OWNER_ADMIN' });
      setVenueIds([]);
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
  const suspended = org.status === 'SUSPENDED';

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/owners', label: 'Owners' }}
        title={org.name}
        subtitle={`${org.contactEmail} · ${org.contactPhone}`}
        action={
          <StatusAction
            path={`/admin/organizations/${org.id}/status`}
            restricted={suspended}
            restrictStatus="SUSPENDED"
            restoreStatus="ACTIVE"
            restrictLabel="Suspend organization"
            restoreLabel="Reactivate organization"
            restrictTitle="Suspend this organization?"
            restrictBody="Every owner login is signed out and cannot sign in again. Existing bookings are not cancelled."
            restoreTitle="Reactivate this organization?"
            restoreBody="Their owner logins can sign in again."
            confirmRestrict="Suspend"
            confirmRestore="Reactivate"
            onChanged={() => {
              refetch();
              refetchUsers();
            }}
          />
        }
      />

      {suspended && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <Icon name="ban" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This organization is suspended. Its owners were signed out and cannot log in until you reactivate it.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Venues" value={org.stats.venues} icon="venue" />
        <StatCard label="Total bookings" value={org.stats.totalBookings} icon="calendar" tone="sky" />
        <StatCard
          label="Revenue"
          value={Number(org.stats.revenue).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          icon="rupee"
          tone="violet"
        />
        <StatCard label="Last booked" value={date(org.stats.lastBookedAt)} icon="calendar" tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Details</h2>
          <dl className="space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <Badge value={org.status} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Contact email</dt>
              <dd className="text-right">{org.contactEmail}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Contact phone</dt>
              <dd>{org.contactPhone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Onboarded</dt>
              <dd>{date(org.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Active venues</dt>
              <dd>
                {org.stats.activeVenues} of {org.stats.venues}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Owner logins</dt>
              <dd>
                {org.stats.logins.active} active of {org.stats.logins.total}
              </dd>
            </div>
          </dl>
          {org.stats.totalBookings > 0 && (
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-100 pt-4">
              {Object.entries(org.stats.bookingsByStatus).map(([status, n]) => (
                <span key={status} className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <Badge value={status} />
                  <span className="font-medium text-gray-900">{n}</span>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden p-0 lg:col-span-3">
          <h2 className="px-5 py-4 text-sm font-semibold text-gray-900">Venues</h2>
          {org.venues.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState message="No venues yet." />
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {org.venues.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{v.name}</p>
                    <p className="text-xs text-gray-500">
                      <span className="font-mono">{v.facilityCode}</span>
                      {v.facilities.length > 0 ? ` · ${v.facilities.map((f) => f.name).join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge value={v.status} />
                    <Link href={`/venues/${v.id}`} className="font-medium text-gray-900 hover:underline">
                      View →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <h2 className="px-5 py-4 text-sm font-semibold text-gray-900">Recent bookings</h2>
        {org.recentBookings.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState message="No bookings yet." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Venue</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Start</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {org.recentBookings.map((b) => (
                  <tr key={b.id} className="border-b border-gray-100 last:border-0 hover:bg-brand-50/40">
                    <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
                    <td className="px-4 py-3">{b.venue.name}</td>
                    <td className="px-4 py-3 text-gray-600">{b.customer.name || b.customer.whatsappNumber || b.customer.email || 'Customer'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{new Date(b.startTime).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {b.currency} {b.amount}
                    </td>
                    <td className="px-4 py-3">
                      <Badge value={b.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/bookings/${b.id}`} className="font-medium text-gray-900 hover:underline">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {ownerUsers.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                    <td className="py-2 font-medium">{u.name}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">
                      {u.role}
                      {u.role === 'OWNER_STAFF' && (
                        <span className="block text-xs text-gray-500">
                          {u.venueIds.length === 0
                            ? 'No venue assigned'
                            : org.venues
                                .filter((v) => u.venueIds.includes(v.id))
                                .map((v) => v.name)
                                .join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge value={u.status} />
                    </td>
                    <td className="py-2 text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 text-right">
                      <StatusAction
                        compact
                        path={`/admin/organizations/${org.id}/owner-users/${u.id}/status`}
                        restricted={u.status === 'DISABLED'}
                        restrictStatus="DISABLED"
                        restoreStatus="ACTIVE"
                        restrictLabel="Disable"
                        restoreLabel="Enable"
                        restrictTitle={`Disable ${u.name}?`}
                        restrictBody="They are signed out and cannot log in. Other logins are unaffected."
                        restoreTitle={`Enable ${u.name}?`}
                        restoreBody="They can log in again."
                        confirmRestrict="Disable"
                        confirmRestore="Enable"
                        onChanged={() => {
                          refetchUsers();
                          refetch();
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          ownerUsers && <p className="mb-6 text-sm text-gray-500">No owner logins yet.</p>
        )}

        <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
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
            <Label htmlFor="invite-name">Name</Label>
            <Input
              id="invite-name"
              value={form.name}
              aria-invalid={!!errors.name}
              className={errors.name ? invalidClass : ''}
              onChange={(e) => edit('name', e.target.value)}
            />
            <FieldError id="invite-name-error" message={errors.name} />
          </div>
          <div>
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={form.email}
              aria-invalid={!!errors.email}
              className={errors.email ? invalidClass : ''}
              onChange={(e) => edit('email', e.target.value)}
            />
            <FieldError id="invite-email-error" message={errors.email} />
          </div>
          <div>
            <Label htmlFor="invite-phone">Phone (optional)</Label>
            <Input
              id="invite-phone"
              type="tel"
              value={form.phone}
              aria-invalid={!!errors.phone}
              className={errors.phone ? invalidClass : ''}
              onChange={(e) => edit('phone', e.target.value)}
            />
            <FieldError id="invite-phone-error" message={errors.phone} />
          </div>
          <div>
            <Label>Role</Label>
            <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              <option value="OWNER_ADMIN">OWNER_ADMIN</option>
              <option value="OWNER_STAFF">OWNER_STAFF</option>
            </Select>
          </div>
          {form.role === 'OWNER_STAFF' && (
            <fieldset className="col-span-2">
              <legend className="mb-1.5 block text-xs font-medium text-gray-700">Venues they work in</legend>
              <div
                className={`max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 ${errors.venues ? 'border-red-500' : 'border-gray-300'}`}
              >
                {org.venues.length === 0 && <p className="px-2 py-1 text-sm text-gray-500">This organization has no venues yet.</p>}
                {org.venues.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={venueIds.includes(v.id)}
                      onChange={() => {
                        setErrors((p) => ({ ...p, venues: undefined }));
                        setVenueIds((cur) => (cur.includes(v.id) ? cur.filter((x) => x !== v.id) : [...cur, v.id]));
                      }}
                    />
                    {v.name}
                  </label>
                ))}
              </div>
              <FieldError id="invite-venues-error" message={errors.venues} />
            </fieldset>
          )}
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
