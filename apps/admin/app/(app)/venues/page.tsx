'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import type { VenueCategorySummary } from '@/lib/categories';
import { Icon } from '@/components/icons';
import { Dropdown } from '@/components/dropdown';
import { SortHeader, type SortDir } from '@/components/sort-header';
import { Pagination, usePageSlice } from '@/components/pagination';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, SkeletonTable } from '@/components/ui';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  status: string;
  address: string;
  organizationId: string;
  category?: VenueCategorySummary;
}

type SortKey = 'code' | 'name' | 'type' | 'status';
type SortChoice = `${SortKey}:${SortDir}`;

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  DRAFT: 'Draft',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
};

const SORTERS: Record<SortKey, (a: Venue, b: Venue) => number> = {
  code: (a, b) => a.facilityCode.localeCompare(b.facilityCode),
  name: (a, b) => a.name.localeCompare(b.name),
  type: (a, b) => (a.category?.name ?? '').localeCompare(b.category?.name ?? '') || a.name.localeCompare(b.name),
  status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
};

export default function VenuesPage() {
  const { data, error, loading } = useFetch<Venue[]>('/venues/mine');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });

  const typeOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const v of data ?? []) if (v.category) names.set(v.category.slug, v.category.name);
    return [
      { value: 'all', label: 'All types' },
      ...[...names.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    ];
  }, [data]);

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of data ?? []) counts.set(v.status, (counts.get(v.status) ?? 0) + 1);
    return [
      { value: 'all', label: 'Any', hint: `${data?.length ?? 0} venues` },
      ...[...counts.entries()].map(([value, n]) => ({
        value,
        label: STATUS_LABELS[value] ?? value,
        hint: `${n} venue${n === 1 ? '' : 's'}`,
      })),
    ];
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data ?? []).filter((v) => {
      if (status !== 'all' && v.status !== status) return false;
      if (type !== 'all' && v.category?.slug !== type) return false;
      if (!q) return true;
      return [v.name, v.facilityCode, v.address, v.category?.name ?? ''].some((s) => s.toLowerCase().includes(q));
    });
    rows.sort(SORTERS[sort.key]);
    if (sort.dir === 'desc') rows.reverse();
    return rows;
  }, [data, query, status, type, sort]);

  const paged = usePageSlice(visible, PAGE_SIZE, `${query}|${status}|${type}|${sort.key}|${sort.dir}`);
  const filtersActive = query.trim() !== '' || status !== 'all' || type !== 'all';
  const activeCount = data?.filter((v) => v.status === 'ACTIVE').length ?? 0;
  const onSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setType('all');
  };

  return (
    <div>
      <section className="mb-4 rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Venues</h1>
            <p className="mt-1 text-sm text-gray-500">
              {data
                ? `${data.length} venue${data.length === 1 ? '' : 's'} · ${activeCount} active.`
                : 'Every venue on the platform.'}
            </p>
          </div>
          <Link href="/venues/new" className="shrink-0">
            <Button>
              <Icon name="plus" className="h-4 w-4" />
              New venue
            </Button>
          </Link>
        </div>

        {data && data.length > 0 && (
          <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3">
            <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
              <div className="relative min-w-[12rem] flex-1 basis-full lg:basis-0">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, facility code, address or type…"
                  aria-label="Search venues"
                  className="h-10 pl-9"
                />
              </div>

              <Dropdown label="Status" value={status} neutral="all" options={statusOptions} onChange={setStatus} />
              <Dropdown label="Type" value={type} neutral="all" options={typeOptions} onChange={setType} />
              <Dropdown<SortChoice>
                label="Sort"
                value={`${sort.key}:${sort.dir}` as SortChoice}
                align="right"
                onChange={(v) => {
                  const [key, dir] = v.split(':') as [SortKey, SortDir];
                  setSort({ key, dir });
                }}
                options={[
                  { value: 'name:asc', label: 'Name A–Z' },
                  { value: 'name:desc', label: 'Name Z–A' },
                  { value: 'code:asc', label: 'Facility code' },
                  { value: 'type:asc', label: 'Type' },
                  { value: 'status:asc', label: 'Status' },
                ]}
              />
            </div>

            {filtersActive && (
              <div className="mt-2.5 flex items-center gap-3 text-sm" aria-live="polite">
                <span className="text-gray-500">
                  Showing {visible.length} of {data.length} venue{data.length === 1 ? '' : 's'}
                </span>
                <button type="button" onClick={clearFilters} className="font-medium text-brand-700 hover:underline">
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {loading && <SkeletonTable columns={6} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No venues yet." />}
      {data && data.length > 0 && visible.length === 0 && (
        <EmptyState message="No venues match your search or filters." />
      )}
      {data && visible.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Facility code" k="code" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <SortHeader label="Name" k="name" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <SortHeader label="Type" k="type" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <th className="px-4 py-3">Address</th>
                <SortHeader label="Status" k="status" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((venue) => (
                <tr key={venue.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{venue.facilityCode}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{venue.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{venue.category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{venue.address}</td>
                  <td className="px-4 py-3">
                    <Badge value={venue.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/venues/${venue.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={paged.page} pageSize={PAGE_SIZE} total={paged.total} onPage={paged.setPage} />
        </Card>
      )}
    </div>
  );
}
