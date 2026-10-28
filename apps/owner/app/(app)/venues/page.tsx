'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import type { VenueCategorySummary } from '@/lib/categories';
import { Badge, Button, ErrorBanner, PageHeader } from '@/components/ui';
import {
  DataTable,
  FilterSelect,
  ListToolbar,
  Pagination,
  ROW,
  SearchBox,
  usePageSlice,
} from '@/components/list-kit';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  status: string;
  address: string;
  facilities?: VenueCategorySummary[];
}

const PAGE = 10;

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

export default function VenuesPage() {
  const { data, error, loading } = useFetch<Venue[]>('/venues/mine');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [facility, setFacility] = useState('');

  const facilityOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const v of data ?? []) for (const f of v.facilities ?? []) names.set(f.slug, f.name);
    return [
      { value: '', label: 'All' },
      ...[...names]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((v) => {
      if (status && v.status !== status) return false;
      if (facility && !v.facilities?.some((f) => f.slug === facility)) return false;
      if (!q) return true;
      return [v.name, v.facilityCode, v.address, ...(v.facilities ?? []).map((f) => f.name)].some(
        (t) => t.toLowerCase().includes(q),
      );
    });
  }, [data, search, status, facility]);

  const active = search !== '' || status !== '' || facility !== '';
  const paged = usePageSlice(filtered, PAGE, `${search}|${status}|${facility}`);

  return (
    <div>
      <PageHeader
        title="My Venues"
        subtitle="The places you run. Open one to manage its units and prices."
        action={
          <Link href="/venues/new">
            <Button>+ New venue</Button>
          </Link>
        }
      />
      {error && <ErrorBanner message={error} />}
      {data && data.length > 0 && (
        <ListToolbar
          active={active}
          total={filtered.length}
          noun="venue"
          onClear={() => {
            setSearch('');
            setStatus('');
            setFacility('');
          }}
          search={
            <SearchBox
              label="Search venues"
              placeholder="Search name, code, address or facility…"
              value={search}
              onChange={setSearch}
            />
          }
        >
          <FilterSelect
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
          {facilityOptions.length > 2 && (
            <FilterSelect
              label="Facility"
              value={facility}
              options={facilityOptions}
              onChange={setFacility}
            />
          )}
        </ListToolbar>
      )}
      {!error && (
        <DataTable
          columns={[
            'Code',
            'Name',
            'Facilities',
            'Address',
            'Status',
            { label: '', className: 'w-28' },
          ]}
          loading={loading}
          rowCount={paged.rows.length}
          empty={
            data && data.length > 0
              ? 'No venues match your search or filters.'
              : "You haven't added a venue yet. Create one to get started."
          }
          footer={
            <Pagination
              page={paged.page}
              pageSize={PAGE}
              total={paged.total}
              onPage={paged.setPage}
            />
          }
        >
          {paged.rows.map((venue) => (
            <tr key={venue.id} className={ROW}>
              <td className="px-4 py-3 font-mono text-xs">{venue.facilityCode}</td>
              <td className="px-4 py-3 font-medium text-on-surface">
                <Link href={`/venues/${venue.id}`} className="hover:text-primary hover:underline">
                  {venue.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                {venue.facilities?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {venue.facilities.map((f) => (
                      <span
                        key={f.id}
                        className="rounded-full bg-primary-fixed-dim/20 px-2.5 py-0.5 text-xs font-medium text-on-primary-container"
                      >
                        {f.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-on-surface-variant">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-on-surface-variant">{venue.address}</td>
              <td className="px-4 py-3">
                <Badge value={venue.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/venues/${venue.id}`}
                  className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
                >
                  Manage →
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
