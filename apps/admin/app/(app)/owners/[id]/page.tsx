'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { api, ApiError } from '@/lib/api';
import { isOwnerEmailTaken, OWNER_EMAIL_TAKEN_MESSAGE } from '@/lib/email-check';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/modal';
import { StatusAction } from '@/components/status-action';
import { ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Pagination, usePageSlice } from '@/components/pagination';
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
  SkeletonTable,
  SkeletonText,
  StatCard,
  SuccessBanner,
  invalidClass,
} from '@/components/ui';
import { emailError, hasErrors, indianPhoneError, textError, type FieldErrors } from '@/lib/validation';
import { PhoneInput, formatPhone } from '@/components/phone-input';
import { BankDetailsPanel } from '@/components/bank-details-panel';

interface OrgVenue {
  id: string;
  name: string;
  facilityCode: string;
  status: string;
  facilities: Array<{ id: string; name: string }>;
}

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
  venues: OrgVenue[];
}

interface OrgBooking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  venue: { name: string };
  /** A walk-in recorded by venue staff: its details are on the booking, not a customer account. */
  isWalkIn?: boolean;
  customer: { name: string | null; whatsappNumber: string | null; email: string | null };
}

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

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const VENUE_PAGE = 10;
const PICKER_PAGE = 8;

type Tab = 'bookings' | 'venues' | 'logins';

/** Venues whose name, code or facility contains the search text. */
function matchVenues(venues: OrgVenue[], term: string): OrgVenue[] {
  const q = term.trim().toLowerCase();
  if (!q) return venues;
  return venues.filter((v) => [v.name, v.facilityCode, ...v.facilities.map((f) => f.name)].some((t) => t.toLowerCase().includes(q)));
}

/** A sign-up waiting for the Super Admin: approve it (the owner is emailed and sees the real portal), or refuse it. */
function ApprovalPanel({ org, onChanged }: { org: { id: string; name: string; status: string; contactEmail: string }; onChanged: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rejected = org.status === 'REJECTED';

  async function set(status: 'ACTIVE' | 'REJECTED') {
    setBusy(status === 'ACTIVE' ? 'approve' : 'reject');
    setError(null);
    try {
      await api.patch(`/admin/organizations/${org.id}/status`, { status, reason: reason.trim() || undefined });
      setRejecting(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the status.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Approval" className={`rounded-xl border px-5 py-4 ${rejected ? 'border-red-200 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h2 className={`text-sm font-semibold ${rejected ? 'text-red-900' : 'text-amber-900'}`}>{rejected ? 'This sign-up was refused' : 'Waiting for your approval'}</h2>
          <p className={`mt-1 text-sm ${rejected ? 'text-red-800' : 'text-amber-900/90'}`}>
            {rejected
              ? 'Its owners cannot sign in. You can still approve it.'
              : `${org.name} signed up on its own. Its owner can sign in but sees only a waiting page, and cannot add venues, until you approve it. Check the business and the contact details (${org.contactEmail}) first.`}
          </p>
          {error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" onClick={() => set('ACTIVE')} loading={busy === 'approve'}>
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          {!rejected && (
            <Button type="button" variant="danger" onClick={() => setRejecting(true)} disabled={busy !== null}>
              Reject
            </Button>
          )}
        </div>
      </div>
      {rejecting && (
        <Modal title="Reject this sign-up?" subtitle={`${org.name} will not be able to sign in. You can approve it later if you change your mind.`} onClose={() => setRejecting(false)} busy={busy === 'reject'}>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div>
              <label htmlFor="reject-reason" className="mb-1 block text-sm font-medium text-gray-700">Reason (kept in the audit log, optional)</label>
              <textarea id="reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRejecting(false)} disabled={busy === 'reject'}>Cancel</Button>
              <Button type="button" variant="danger" onClick={() => set('REJECTED')} loading={busy === 'reject'}>Reject sign-up</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function OwnerOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: org, error, loading, refetch } = useFetch<Organization>(`/admin/organizations/${id}`);
  const [tab, setTab] = useState<Tab>('bookings');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped when a login is added, so the Logins tab loads its list again.
  const [loginsVersion, setLoginsVersion] = useState(0);

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

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'bookings', label: 'Bookings', count: org.stats.totalBookings },
    { key: 'venues', label: 'Venues', count: org.venues.length },
    { key: 'logins', label: 'Logins', count: org.stats.logins.total },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/owners', label: 'Owners' }}
        title={org.name}
        subtitle={`${org.contactEmail} · ${formatPhone(org.contactPhone)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setNotice(null);
                setInviting(true);
              }}
            >
              + Add owner
            </Button>
            {(org.status === 'ACTIVE' || suspended) && (
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
                setLoginsVersion((v) => v + 1);
              }}
            />
            )}
          </div>
        }
      />

      {notice && <SuccessBanner message={notice} />}

      {(org.status === 'PENDING_APPROVAL' || org.status === 'REJECTED') && (
        <ApprovalPanel org={org} onChanged={() => { refetch(); setLoginsVersion((v) => v + 1); }} />
      )}

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

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="mt-1">
              <Badge value={org.status} />
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Onboarded</dt>
            <dd className="mt-1">{date(org.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Active venues</dt>
            <dd className="mt-1">
              {org.stats.activeVenues} of {org.stats.venues}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Owner logins</dt>
            <dd className="mt-1">
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

      <BankDetailsPanel organizationId={org.id} />

      <div>
        <div role="tablist" aria-label="Owner sections" className="mb-4 flex gap-1 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="owner-tabpanel"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label} <span className="ml-1 text-xs font-normal text-gray-500">{t.count}</span>
            </button>
          ))}
        </div>

        <div id="owner-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === 'bookings' && <BookingsTab orgId={org.id} />}
          {tab === 'venues' && <VenuesTab venues={org.venues} />}
          {/* A new key loads the list again after a login is added or the organization is suspended or reactivated. */}
          {tab === 'logins' && <LoginsTab key={loginsVersion} org={org} onChanged={refetch} />}
        </div>
      </div>

      {inviting && (
        <Modal title="Add owner" subtitle="They get an email with a link to choose their own password." onClose={() => setInviting(false)}>
          <InviteForm
            orgId={org.id}
            venues={org.venues}
            onCancel={() => setInviting(false)}
            onInvited={(email) => {
              setInviting(false);
              setNotice(`Invited ${email} — they'll get an email to set their password.`);
              setLoginsVersion((v) => v + 1);
              setTab('logins');
              refetch();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/** The organization's bookings, newest first, searched and paged by the server. */
function BookingsTab({ orgId }: { orgId: string }) {
  const f = useListFilters({ search: '' });
  const query = [`organizationId=${orgId}`, f.query].filter(Boolean).join('&');
  const { rows, total, error, loading } = usePagedFetch<OrgBooking>('/admin/bookings', query, f.page);

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-4">
        <ListToolbar
          active={f.active}
          total={total}
          noun="booking"
          onClear={f.clear}
          search={
            <SearchBox
              label="Search bookings"
              placeholder="Search order ID, customer, phone or venue…"
              value={f.values.search}
              onChange={(v) => f.set('search', v)}
            />
          }
        />
      </div>
      {error && (
        <div className="px-5 pb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading && rows.length === 0 && !error && <SkeletonTable columns={7} rows={5} />}
      {!loading && !error && rows.length === 0 && (
        <div className="px-5 pb-5">
          <EmptyState message={f.active ? 'No bookings match your search.' : 'No bookings yet.'} />
        </div>
      )}
      {rows.length > 0 && (
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
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 last:border-0 hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
                  <td className="px-4 py-3">{b.venue.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {b.customer.name || b.customer.whatsappNumber || b.customer.email || 'Customer'}
                    {b.isWalkIn && (
                      <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-gray-600">Walk-in</span>
                    )}
                  </td>
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
      <Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />
    </Card>
  );
}

/** The organization's venues (they come with the page, in full): searched and paged here. */
function VenuesTab({ venues }: { venues: OrgVenue[] }) {
  const [search, setSearch] = useState('');
  const shown = useMemo(() => matchVenues(venues, search), [venues, search]);
  const page = usePageSlice(shown, VENUE_PAGE, search);

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-4">
        <ListToolbar
          active={search !== ''}
          total={shown.length}
          noun="venue"
          onClear={() => setSearch('')}
          search={<SearchBox label="Search venues" placeholder="Search name, code or facility…" value={search} onChange={setSearch} />}
        />
      </div>
      {venues.length === 0 && (
        <div className="px-5 pb-5">
          <EmptyState message="No venues yet." />
        </div>
      )}
      {venues.length > 0 && shown.length === 0 && <p className="px-5 pb-5 text-sm text-gray-500">No venues match your search.</p>}
      {shown.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {page.rows.map((v) => (
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
      <Pagination page={page.page} pageSize={VENUE_PAGE} total={page.total} onPage={page.setPage} />
    </Card>
  );
}

/** The organization's owner logins, searched and paged by the server. */
function LoginsTab({ org, onChanged }: { org: Organization; onChanged: () => void }) {
  const f = useListFilters({ search: '' });
  const { rows, total, error, loading, refetch } = usePagedFetch<OwnerUser>(`/admin/organizations/${org.id}/owner-users`, f.query, f.page);

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-4">
        <ListToolbar
          active={f.active}
          total={total}
          noun="login"
          onClear={f.clear}
          search={
            <SearchBox
              label="Search logins"
              placeholder="Search name or email…"
              value={f.values.search}
              onChange={(v) => f.set('search', v)}
            />
          }
        />
      </div>
      {error && (
        <div className="px-5 pb-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {loading && rows.length === 0 && !error && <SkeletonTable columns={6} rows={4} />}
      {!loading && !error && rows.length === 0 && (
        <p className="px-5 pb-5 text-sm text-gray-500">{f.active ? 'No logins match your search.' : 'No owner logins yet.'}</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Invited</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3">
                    <Badge value={u.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
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
                        refetch();
                        onChanged();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />
    </Card>
  );
}

/** The form inside the "Add owner" dialog: an owner admin, or staff limited to chosen venues. */
function InviteForm({
  orgId,
  venues,
  onCancel,
  onInvited,
}: {
  orgId: string;
  venues: OrgVenue[];
  onCancel: () => void;
  onInvited: (email: string) => void;
}) {
  const [form, setForm] = useState({ email: '', name: '', phone: '', role: 'OWNER_ADMIN' });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<'name' | 'email' | 'phone' | 'venues'>>({});
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const pickerVenues = useMemo(() => matchVenues(venues, pickerSearch), [venues, pickerSearch]);
  const pickerPage = usePageSlice(pickerVenues, PICKER_PAGE, pickerSearch);

  const edit = (k: 'name' | 'email' | 'phone' | 'role', v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k !== 'role') setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found: FieldErrors<'name' | 'email' | 'phone' | 'venues'> = {
      name: textError(form.name, 'Name', 1, 150),
      email: emailError(form.email, 'their email address'),
      phone: indianPhoneError(form.phone, 'their phone number', false),
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
      await api.post(`/admin/organizations/${orgId}/owner-users`, {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone || undefined,
        venueIds: form.role === 'OWNER_STAFF' ? venueIds : undefined,
      });
      onInvited(form.email.trim());
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrors((p) => ({ ...p, email: OWNER_EMAIL_TAKEN_MESSAGE + ' Use a different email.' }));
        document.getElementById('invite-email')?.focus();
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Failed to create owner user');
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {formError && (
        <div className="sm:col-span-2">
          <ErrorBanner message={formError} />
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
          onBlur={async () => {
            if (await isOwnerEmailTaken(form.email)) setErrors((p) => ({ ...p, email: OWNER_EMAIL_TAKEN_MESSAGE + ' Use a different email.' }));
          }}
        />
        <FieldError id="invite-email-error" message={errors.email} />
      </div>
      <div>
        <Label htmlFor="invite-phone">Phone (optional)</Label>
        <PhoneInput id="invite-phone" value={form.phone} invalid={!!errors.phone} onValueChange={(digits) => edit('phone', digits)} />
        <FieldError id="invite-phone-error" message={errors.phone} />
      </div>
      <div>
        <Label htmlFor="invite-role">Role</Label>
        <Select id="invite-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value="OWNER_ADMIN">OWNER_ADMIN</option>
          <option value="OWNER_STAFF">OWNER_STAFF</option>
        </Select>
      </div>
      {form.role === 'OWNER_STAFF' && (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 block text-xs font-medium text-gray-700">Venues they work in</legend>
          {venues.length > PICKER_PAGE && (
            <div className="mb-2">
              <Input
                aria-label="Search venues to assign"
                placeholder="Search venues…"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault(); // searching must not send the invite
                }}
              />
            </div>
          )}
          <div className={`space-y-1 overflow-hidden rounded-lg border p-2 ${errors.venues ? 'border-red-500' : 'border-gray-300'}`}>
            {venues.length === 0 && <p className="px-2 py-1 text-sm text-gray-500">This organization has no venues yet.</p>}
            {venues.length > 0 && pickerVenues.length === 0 && <p className="px-2 py-1 text-sm text-gray-500">No venues match your search.</p>}
            {pickerPage.rows.map((v) => (
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
          <Pagination page={pickerPage.page} pageSize={PICKER_PAGE} total={pickerPage.total} onPage={pickerPage.setPage} />
          {venueIds.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {venueIds.length} venue{venueIds.length === 1 ? '' : 's'} chosen.
            </p>
          )}
          <FieldError id="invite-venues-error" message={errors.venues} />
        </fieldset>
      )}
      <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <Button type="submit" loading={submitting}>
          {submitting ? 'Inviting…' : 'Invite Owner'}
        </Button>
      </div>
    </form>
  );
}
