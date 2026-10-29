'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { ErrorBanner, PageHeader } from '@/components/ui';
import { DataTable, DateRangeFilter, FilterSelect, ListToolbar, Pagination, ROW, SearchBox } from '@/components/list-kit';

type ActorType = 'ADMIN' | 'OWNER' | 'CUSTOMER' | 'SYSTEM';

interface Entry {
  id: string;
  createdAt: string;
  actorType: ActorType;
  actor: { id: string; name: string; email: string; role: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
}

const ACTOR_OPTIONS = [
  { value: '', label: 'Anyone' },
  { value: 'OWNER', label: 'Your team' },
  { value: 'ADMIN', label: 'The platform team' },
  { value: 'CUSTOMER', label: 'A customer' },
  { value: 'SYSTEM', label: 'The system' },
];

const ACTOR_LABEL: Record<ActorType, string> = {
  OWNER: 'Your team',
  ADMIN: 'The platform team',
  CUSTOMER: 'A customer',
  SYSTEM: 'The system',
};

const ROLE_LABEL: Record<string, string> = { OWNER_ADMIN: 'Owner admin', OWNER_STAFF: 'Staff' };

/** Where in this portal to look at what an entry is about, where there is such a page. */
const SUBJECT_PAGE: Record<string, (id: string) => string> = {
  Venue: (id) => `/venues/${id}`,
  Booking: (id) => `/bookings/${id}`,
  Payout: (id) => `/earnings/${id}`,
  VenueOwnerUser: () => '/staff',
  OwnerOrganization: () => '/settings',
};

/** "VENUE_UPDATED" -> "Venue updated". */
const sentence = (code: string) => {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/** "VenueOwnerUser" -> "Venue owner user". */
const kind = (type: string) =>
  type
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

export default function AuditLogPage() {
  const f = useListFilters({ search: '', actorType: '', entityType: '', action: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Entry>('/owner/audit-log', f.query, f.page);
  const facets = useFetch<{ entityTypes: string[]; actions: string[] }>('/owner/audit-log/facets');
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
      <PageHeader title="Audit log" subtitle="What your team did, and what was done to your venues, bookings, payouts and logins. Newest first." />
      <ListToolbar
        active={f.active}
        total={total}
        noun="record"
        onClear={f.clear}
        search={
          <SearchBox
            label="Search the audit log"
            placeholder="Search by person, action or id…"
            value={f.values.search}
            onChange={(v) => f.set('search', v)}
          />
        }
      >
        <FilterSelect label="By" value={f.values.actorType} options={ACTOR_OPTIONS} onChange={(v) => f.set('actorType', v)} />
        <FilterSelect label="About" value={f.values.entityType} options={kindOptions} onChange={(v) => f.set('entityType', v)} />
        <FilterSelect label="Action" value={f.values.action} options={actionOptions} onChange={(v) => f.set('action', v)} />
        <DateRangeFilter label="Date" from={f.values.from} to={f.values.to} onFrom={(v) => f.set('from', v)} onTo={(v) => f.set('to', v)} />
      </ListToolbar>

      {error && <ErrorBanner message={error} />}
      {!error && (
        <DataTable
          columns={['When', 'Who', 'What happened', 'About', { label: '', className: 'w-24' }]}
          loading={loading}
          rowCount={rows.length}
          empty={f.active ? 'No entries match your search or filters.' : 'Nothing has been recorded yet.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {rows.map((e) => {
            const expanded = open.has(e.id);
            const subject = SUBJECT_PAGE[e.entityType]?.(e.entityId);
            return (
              <Fragment key={e.id}>
                <tr className={`${ROW} align-top`}>
                  <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                    {new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-3">
                    {e.actor ? (
                      <>
                        <p className="font-medium text-on-surface">{e.actor.name || e.actor.email}</p>
                        <p className="text-xs text-on-surface-variant">
                          {ROLE_LABEL[e.actor.role] ?? e.actor.role} · {e.actor.email}
                        </p>
                      </>
                    ) : (
                      <p className="text-on-surface">{e.actorType === 'OWNER' ? 'A former team member' : ACTOR_LABEL[e.actorType]}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-on-surface">{sentence(e.action)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-on-surface">{kind(e.entityType)}</p>
                    {subject ? (
                      <Link href={subject} className="font-mono text-xs text-primary hover:underline" title={e.entityId}>
                        {e.entityId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-on-surface-variant" title={e.entityId}>
                        {e.entityId.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" aria-expanded={expanded} onClick={() => toggle(e.id)} className="text-sm font-medium text-primary hover:underline">
                      {expanded ? 'Hide' : 'Details'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                    <td colSpan={5} className="px-4 py-3">
                      <p className="mb-2 text-xs text-on-surface-variant">
                        Exact time: {new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })} · Id:{' '}
                        <span className="break-all font-mono">{e.entityId}</span>
                      </p>
                      {e.metadata ? (
                        <pre className="max-h-72 overflow-auto rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3 text-xs leading-relaxed text-on-surface">
                          {JSON.stringify(e.metadata, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-xs text-on-surface-variant">
                          {e.actor ? 'No extra details were recorded for this entry.' : 'Details of actions by others are not shown.'}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
