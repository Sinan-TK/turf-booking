'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Dropdown } from '@/components/dropdown';
import { ListSection, FilterSummary } from '@/components/list-section';
import { Pagination, usePageSlice } from '@/components/pagination';
import { SortHeader, type SortDir } from '@/components/sort-header';
import { Badge, Button, Card, EmptyState, ErrorBanner, FieldError, Input, Label, SkeletonTable, invalidClass } from '@/components/ui';
import { emailError, hasErrors, indianPhoneError, textError, type FieldErrors } from '@/lib/validation';
import { PhoneInput, formatPhone } from '@/components/phone-input';

interface Organization {
  id: string;
  name: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
}

type SortKey = 'name' | 'status';
type SortChoice = `${SortKey}:${SortDir}`;

const PAGE_SIZE = 25;

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
  DRAFT: 'Draft',
};

const SORTERS: Record<SortKey, (a: Organization, b: Organization) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
};

const EMPTY_FORM = { name: '', contactEmail: '', contactPhone: '' };

export default function OwnersPage() {
  const { data, error, loading, refetch } = useFetch<Organization[]>('/admin/organizations');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<keyof typeof EMPTY_FORM>>({});
  const edit = (k: keyof typeof EMPTY_FORM, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  };

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const found: FieldErrors<keyof typeof EMPTY_FORM> = {
      name: textError(form.name, 'Organization name', 1, 150),
      contactEmail: emailError(form.contactEmail, 'the contact email'),
      contactPhone: indianPhoneError(form.contactPhone, 'the contact phone'),
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['name', 'contactEmail', 'contactPhone'] as const).find((k) => found[k]);
      document.getElementById('org-' + first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/organizations', { ...form, name: form.name.trim(), contactEmail: form.contactEmail.trim(), contactPhone: form.contactPhone });
      setForm(EMPTY_FORM);
      setErrors({});
      setShowForm(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  }

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of data ?? []) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return [
      { value: 'all', label: 'Any', hint: `${data?.length ?? 0} organizations` },
      ...[...counts.entries()].map(([value, n]) => ({
        value,
        label: STATUS_LABELS[value] ?? value,
        hint: `${n} organization${n === 1 ? '' : 's'}`,
      })),
    ];
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (data ?? []).filter((o) => {
      if (status !== 'all' && o.status !== status) return false;
      if (!q) return true;
      return [o.name, o.contactEmail, o.contactPhone, formatPhone(o.contactPhone)].some((s) => s.toLowerCase().includes(q));
    });
    rows.sort(SORTERS[sort.key]);
    if (sort.dir === 'desc') rows.reverse();
    return rows;
  }, [data, query, status, sort]);

  const paged = usePageSlice(visible, PAGE_SIZE, `${query}|${status}|${sort.key}|${sort.dir}`);
  const filtersActive = query.trim() !== '' || status !== 'all';
  const activeCount = data?.filter((o) => o.status === 'ACTIVE').length ?? 0;
  const onSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const clearFilters = () => {
    setQuery('');
    setStatus('all');
  };

  return (
    <div>
      <ListSection
        title="Owner organizations"
        subtitle={
          data
            ? `${data.length} organization${data.length === 1 ? '' : 's'} · ${activeCount} active.`
            : 'The businesses that own venues on the platform.'
        }
        action={
          <Button onClick={() => setShowForm((v) => !v)} variant={showForm ? 'secondary' : 'primary'}>
            <Icon name={showForm ? 'close' : 'plus'} className="h-4 w-4" />
            {showForm ? 'Cancel' : 'New organization'}
          </Button>
        }
      >
        {data && data.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
              <div className="relative min-w-[12rem] flex-1 basis-full lg:basis-0">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, email or phone…"
                  aria-label="Search organizations"
                  className="h-10 pl-9"
                />
              </div>
              <Dropdown label="Status" value={status} neutral="all" options={statusOptions} onChange={setStatus} />
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
                  { value: 'status:asc', label: 'Status' },
                ]}
              />
            </div>
            {filtersActive && (
              <FilterSummary shown={visible.length} total={data.length} noun="organizations" onClear={clearFilters} />
            )}
          </>
        )}
      </ListSection>

      {showForm && (
        <Card className="mb-4 max-w-xl">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">New organization</h2>
          <form onSubmit={onSubmit} noValidate className="space-y-3">
            {formError && <ErrorBanner message={formError} />}
            <div>
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={form.name}
                aria-invalid={!!errors.name}
                className={errors.name ? invalidClass : ''}
                onChange={(e) => edit('name', e.target.value)}
              />
              <FieldError id="org-name-error" message={errors.name} />
            </div>
            <div>
              <Label htmlFor="org-contactEmail">Contact email</Label>
              <Input
                id="org-contactEmail"
                type="email"
                value={form.contactEmail}
                aria-invalid={!!errors.contactEmail}
                className={errors.contactEmail ? invalidClass : ''}
                onChange={(e) => edit('contactEmail', e.target.value)}
              />
              <FieldError id="org-contactEmail-error" message={errors.contactEmail} />
            </div>
            <div>
              <Label htmlFor="org-contactPhone">Contact phone</Label>
              <PhoneInput
                id="org-contactPhone"
                value={form.contactPhone}
                invalid={!!errors.contactPhone}
                onValueChange={(digits) => edit('contactPhone', digits)}
              />
              <FieldError id="org-contactPhone-error" message={errors.contactPhone} />
            </div>
            <Button type="submit" loading={submitting}>
              {submitting ? 'Creating…' : 'Create organization'}
            </Button>
          </form>
        </Card>
      )}

      {loading && <SkeletonTable columns={4} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No owner organizations yet." />}
      {data && data.length > 0 && visible.length === 0 && (
        <EmptyState message="No organizations match your search or filters." />
      )}
      {data && visible.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <SortHeader label="Name" k="name" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <th className="px-4 py-3">Contact</th>
                <SortHeader label="Status" k="status" sortKey={sort.key} dir={sort.dir} onSort={onSort} />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((org) => (
                <tr key={org.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {org.contactEmail}
                    <br />
                    {formatPhone(org.contactPhone)}
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
          <Pagination page={paged.page} pageSize={PAGE_SIZE} total={paged.total} onPage={paged.setPage} />
        </Card>
      )}
    </div>
  );
}
