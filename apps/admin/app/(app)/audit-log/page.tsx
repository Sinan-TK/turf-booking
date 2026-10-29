'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { DateRangeFilter, ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Pagination } from '@/components/pagination';
import { Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

type ActorType = 'ADMIN' | 'OWNER' | 'CUSTOMER' | 'SYSTEM';

interface Entry {
  id: string;
  createdAt: string;
  actorType: ActorType;
  actor: { id: string; name: string; email: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  ipAddress: string | null;
}

const ACTOR_OPTIONS = [
  { value: '', label: 'Anyone' },
  { value: 'ADMIN', label: 'Super Admin' },
  { value: 'OWNER', label: 'Owner or staff' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'SYSTEM', label: 'The system' },
];

const ACTOR_STYLE: Record<ActorType, { label: string; className: string }> = {
  ADMIN: { label: 'Super Admin', className: 'bg-violet-50 text-violet-700 ring-violet-200' },
  OWNER: { label: 'Owner', className: 'bg-sky-50 text-sky-700 ring-sky-200' },
  CUSTOMER: { label: 'Customer', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  SYSTEM: { label: 'System', className: 'bg-gray-100 text-gray-600 ring-gray-200' },
};

/** The admin page that shows what an entry is about, where there is one. */
const SUBJECT_PAGE: Record<string, (id: string) => string> = {
  Venue: (id) => `/venues/${id}`,
  VenueCategory: (id) => `/venue-types/${id}`,
  Booking: (id) => `/bookings/${id}`,
  OwnerOrganization: (id) => `/owners/${id}`,
  CustomerProfile: (id) => `/customers/${id}`,
  Payout: (id) => `/payouts/${id}`,
};

/** "VENUE_CATEGORY_UPDATED" -> "Venue category updated". */
const sentence = (code: string) => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/** "OwnerOrganization" -> "Owner organization". */
const kind = (type: string) =>
  type
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

export default function AuditLogPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', actorType: '', entityType: '', action: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Entry>('/admin/audit-logs', query, page);
  const facets = useFetch<{ entityTypes: string[]; actions: string[] }>('/admin/audit-logs/facets');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const kindOptions = useMemo(
    () => [{ value: '', label: 'Anything' }, ...(facets.data?.entityTypes ?? []).map((t) => ({ value: t, label: kind(t) }))],
    [facets.data],
  );
  const actionOptions = useMemo(
    () => [{ value: '', label: 'Any action' }, ...(facets.data?.actions ?? []).map((a) => ({ value: a, label: sentence(a) }))],
    [facets.data],
  );
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div>
      <ListSection
        title="Audit log"
        subtitle={
          loading && total === 0
            ? ''
            : `${total} entr${total === 1 ? 'y' : 'ies'}${active ? ' match your filters' : ' recorded'}. Newest first; entries cannot be changed or removed here.`
        }
      >
        <ListToolbar
          search={
            <SearchBox
              value={values.search}
              onChange={(v) => set('search', v)}
              placeholder="Search by person, action, id or IP address…"
              label="Search the audit log"
            />
          }
          active={active}
          total={total}
          noun="record"
          onClear={clear}
        >
          <Dropdown label="By" value={values.actorType} neutral="" options={ACTOR_OPTIONS} onChange={(v) => set('actorType', v)} />
          <Dropdown label="About" value={values.entityType} neutral="" options={kindOptions} onChange={(v) => set('entityType', v)} />
          <Dropdown label="Action" value={values.action} neutral="" options={actionOptions} onChange={(v) => set('action', v)} />
          <DateRangeFilter label="Date" from={values.from} to={values.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        </ListToolbar>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={5} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message={active ? 'No entries match your search or filters.' : 'Nothing has been recorded yet.'} />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">What happened</th>
                <th className="px-4 py-3">About</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const expanded = open.has(e.id);
                const style = ACTOR_STYLE[e.actorType];
                const subject = SUBJECT_PAGE[e.entityType]?.(e.entityId);
                return (
                  <Fragment key={e.id}>
                    <tr className="border-b border-gray-100 align-top transition-colors hover:bg-brand-50/40">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${style.className}`}>{style.label}</span>
                        {e.actor && (e.actor.name || e.actor.email) && (
                          <p className="mt-1 text-gray-900">
                            {e.actor.name || e.actor.email}
                            {e.actor.name && e.actor.email && <span className="block text-xs text-gray-500">{e.actor.email}</span>}
                          </p>
                        )}
                        {!e.actor && e.actorType !== 'SYSTEM' && <p className="mt-1 text-xs text-gray-400">Account since removed</p>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{sentence(e.action)}</p>
                        <p className="font-mono text-[11px] text-gray-400">{e.action}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-700">{kind(e.entityType)}</p>
                        {subject ? (
                          <Link href={subject} className="font-mono text-xs text-brand-700 hover:underline" title={e.entityId}>
                            {e.entityId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-gray-400" title={e.entityId}>
                            {e.entityId.length > 12 ? `${e.entityId.slice(0, 8)}…` : e.entityId}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" aria-expanded={expanded} onClick={() => toggle(e.id)} className="text-sm font-medium text-gray-900 hover:underline">
                          {expanded ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <dl className="mb-2 grid grid-cols-1 gap-x-8 gap-y-1 text-xs text-gray-600 sm:grid-cols-3">
                            <div>
                              <dt className="inline text-gray-500">Exact time: </dt>
                              <dd className="inline">{new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })}</dd>
                            </div>
                            <div>
                              <dt className="inline text-gray-500">IP address: </dt>
                              <dd className="inline">{e.ipAddress ?? 'not recorded'}</dd>
                            </div>
                            <div className="break-all">
                              <dt className="inline text-gray-500">Subject id: </dt>
                              <dd className="inline font-mono">{e.entityId}</dd>
                            </div>
                          </dl>
                          {e.metadata ? (
                            <pre className="max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white p-3 text-xs leading-relaxed text-gray-800">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                          ) : (
                            <p className="text-xs text-gray-500">No extra details were recorded for this entry.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
