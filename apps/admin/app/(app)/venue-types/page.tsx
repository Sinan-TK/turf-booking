'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { durationLabel, type AdminVenueCategory } from '@/lib/categories';
import { Icon } from '@/components/icons';
import { Dropdown } from '@/components/dropdown';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, SkeletonTable } from '@/components/ui';

type StatusFilter = 'all' | 'active' | 'inactive';
type StyleFilter = 'all' | 'EXCLUSIVE' | 'POOLED';
type SortKey = 'order' | 'name' | 'style' | 'starts' | 'length' | 'venues' | 'status';
type SortState = { key: SortKey; dir: 'asc' | 'desc' };
type SortChoice = `${SortKey}:${'asc' | 'desc'}`;

const SORTERS: Record<SortKey, (a: AdminVenueCategory, b: AdminVenueCategory) => number> = {
  order: (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name),
  style: (a, b) => a.defaultAllocationMode.localeCompare(b.defaultAllocationMode),
  starts: (a, b) => a.policy.slotIntervalMin - b.policy.slotIntervalMin,
  length: (a, b) => a.policy.maxDurationMin - b.policy.maxDurationMin,
  venues: (a, b) => a.venueCount - b.venueCount,
  status: (a, b) => Number(b.isActive) - Number(a.isActive),
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th className="px-4 py-3" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`group inline-flex items-center gap-1 uppercase tracking-wide ${active ? 'text-gray-900' : 'hover:text-gray-800'}`}
      >
        {label}
        <span className={`text-[10px] ${active ? 'text-brand-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
          {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export default function VenueTypesPage() {
  const { data, error, loading, refetch } = useFetch<AdminVenueCategory[]>('/admin/categories');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [style, setStyle] = useState<StyleFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: 'order', dir: 'asc' });

  async function run(id: string, action: () => Promise<unknown>) {
    setActionError(null);
    setBusyId(id);
    try {
      await action();
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  }

  const activeCount = data?.filter((c) => c.isActive).length ?? 0;
  const inactiveCount = (data?.length ?? 0) - activeCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data ?? []).filter((c) => {
      if (status === 'active' && !c.isActive) return false;
      if (status === 'inactive' && c.isActive) return false;
      if (style !== 'all' && c.defaultAllocationMode !== style) return false;
      if (!q) return true;
      return [c.name, c.slug, c.unitLabel, c.venueLabel, ...c.unitTypes].some((v) => v.toLowerCase().includes(q));
    });
    rows.sort(SORTERS[sort.key]);
    if (sort.dir === 'desc') rows.reverse();
    return rows;
  }, [data, query, status, style, sort]);

  const filtersActive = query.trim() !== '' || status !== 'all' || style !== 'all';
  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setStyle('all');
  };
  const onSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div>
      {/* Heading, primary action and search/filters share one section. */}
      <section className="mb-4 rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Venue types</h1>
            <p className="mt-1 text-sm text-gray-500">
              {data
                ? `${data.length} type${data.length === 1 ? '' : 's'} · ${activeCount} active. Each sets its own start times, lengths and wording.`
                : 'Each type sets its own start times, lengths and wording.'}
            </p>
          </div>
          <Link href="/venue-types/new" className="shrink-0">
            <Button>
              <Icon name="plus" className="h-4 w-4" />
              New venue type
            </Button>
          </Link>
        </div>

        {data && data.length > 0 && (
          <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3">
            {/* The search field takes every pixel the filters don't need; the
                filters never shrink or wrap on a laptop-width screen. */}
            <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
              <div className="relative min-w-[12rem] flex-1 basis-full lg:basis-0">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, identifier or sub-type…"
                  aria-label="Search venue types"
                  className="h-10 pl-9"
                />
              </div>

              <div
                role="group"
                aria-label="Filter by status"
                className="inline-flex h-10 shrink-0 items-center rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm"
              >
                {(
                  [
                    ['all', 'All', data.length],
                    ['active', 'Active', activeCount],
                    ['inactive', 'Inactive', inactiveCount],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                    className={`h-full whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                      status === value ? 'bg-brand-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {label} <span className={status === value ? 'text-white/80' : 'text-gray-400'}>{count}</span>
                  </button>
                ))}
              </div>

              <Dropdown<StyleFilter>
                label="Style"
                value={style}
                neutral="all"
                onChange={setStyle}
                options={[
                  { value: 'all', label: 'Any' },
                  { value: 'EXCLUSIVE', label: 'Per unit', hint: 'Customer picks a table, court, room…' },
                  { value: 'POOLED', label: 'Pool (quantity)', hint: 'Shared stock, like kayaks' },
                ]}
              />

              <Dropdown<SortChoice>
                label="Sort"
                value={`${sort.key}:${sort.dir}` as SortChoice}
                align="right"
                onChange={(v) => {
                  const [key, dir] = v.split(':') as [SortKey, 'asc' | 'desc'];
                  setSort({ key, dir });
                }}
                options={[
                  { value: 'order:asc', label: 'Display order' },
                  { value: 'name:asc', label: 'Name A–Z' },
                  { value: 'name:desc', label: 'Name Z–A' },
                  { value: 'venues:desc', label: 'Most venues' },
                  { value: 'venues:asc', label: 'Fewest venues' },
                  { value: 'starts:asc', label: 'Shortest start interval' },
                  { value: 'length:desc', label: 'Longest bookings' },
                ]}
              />
            </div>

            {filtersActive && (
              <div className="mt-2.5 flex items-center gap-3 text-sm" aria-live="polite">
                <span className="text-gray-500">
                  Showing {visible.length} of {data.length} type{data.length === 1 ? '' : 's'}
                </span>
                <button type="button" onClick={clearFilters} className="font-medium text-brand-700 hover:underline">
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {actionError && (
        <div className="mb-4">
          <ErrorBanner message={actionError} />
        </div>
      )}
      {loading && <SkeletonTable columns={7} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No venue types yet. Create the first one." />}
      {data && data.length > 0 && visible.length === 0 && (
        <EmptyState message="No venue types match your search or filters." />
      )}
      {data && visible.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Type" k="name" sort={sort} onSort={onSort} />
                <SortHeader label="Booking style" k="style" sort={sort} onSort={onSort} />
                <SortHeader label="Starts" k="starts" sort={sort} onSort={onSort} />
                <SortHeader label="Length" k="length" sort={sort} onSort={onSort} />
                <SortHeader label="Venues" k="venues" sort={sort} onSort={onSort} />
                <SortHeader label="Status" k="status" sort={sort} onSort={onSort} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const busy = busyId === c.id;
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40 ${c.isActive ? '' : 'bg-gray-50/50 text-gray-500'}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            c.isActive ? 'bg-brand-50 text-brand-600' : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
                            {c.iconKey}
                          </span>
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900">{c.name}</div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono text-xs text-gray-400">{c.slug}</span>
                            {c.unitTypes.map((t) => (
                              <span key={t} className="rounded bg-gray-100 px-1.5 py-px text-[11px] text-gray-600">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {c.defaultAllocationMode === 'POOLED' ? 'Pool (quantity)' : `Per ${c.unitLabel.toLowerCase()}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      every {durationLabel(c.policy.slotIntervalMin)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {durationLabel(c.policy.minDurationMin)}–{durationLabel(c.policy.maxDurationMin)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.venueCount}</td>
                    <td className="px-4 py-3">
                      <Badge value={c.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/venue-types/${c.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                          Edit
                        </Link>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5"
                          loading={busy}
                          disabled={busyId !== null}
                          onClick={() =>
                            run(c.id, () => api.post(`/admin/categories/${c.id}/${c.isActive ? 'deactivate' : 'activate'}`))
                          }
                        >
                          {c.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                        {c.venueCount === 0 &&
                          (confirmDeleteId === c.id ? (
                            <span className="flex items-center gap-2">
                              <Button
                                variant="danger"
                                className="px-3 py-1.5"
                                loading={busy}
                                disabled={busyId !== null}
                                onClick={() => run(c.id, () => api.delete(`/admin/categories/${c.id}`))}
                              >
                                Confirm
                              </Button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-gray-500 hover:text-gray-800">
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(c.id)}
                              disabled={busyId !== null}
                              className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
