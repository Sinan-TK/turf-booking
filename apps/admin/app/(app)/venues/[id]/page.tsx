'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Modal } from '@/components/modal';
import { ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Pagination, usePageSlice } from '@/components/pagination';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import type { VenueCategory, VenueCategorySummary } from '@/lib/categories';
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
  invalidClass,
} from '@/components/ui';
import { hasErrors, textError, type FieldErrors } from '@/lib/validation';
import { VenueTermsSection } from '@/components/venue-terms-section';
import { VenueMapLink } from '@/components/venue-map-link';
import { VenueAdvanceBooking } from '@/components/venue-advance-booking';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  description: string | null;
  address: string;
  googleMapsUrl: string | null;
  advanceBookingDays: number;
  status: string;
  timezone: string;
  organizationId: string;
  defaultSlotGranularityMinutes: number;
  /** Derived from the venue's units: one entry per facility it offers. */
  facilities: VenueCategorySummary[];
}

interface Resource {
  id: string;
  name: string;
  groundType: string;
  category: VenueCategorySummary;
  isBookable: boolean;
  sortOrder: number;
  /** Shortest and longest booking, in minutes. The unit's prices are per block of the shortest. */
  minDurationMinutes: number;
  maxDurationMinutes: number;
}

const STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

type Tab = 'units' | 'settings' | 'terms';

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, mutate } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources } = useFetch<Resource[]>(`/resources?venueId=${id}`);

  const [tab, setTab] = useState<Tab>('units');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function updateStatus(status: string) {
    if (!venue) return;
    const previous = venue.status;
    setStatusError(null);
    setPendingStatus(status);
    // Optimistic: show the new status immediately, revert only if the
    // request actually fails — the common case (success) never makes
    // the admin wait to see the change reflected.
    mutate((prev) => (prev ? { ...prev, status } : prev));
    try {
      await api.patch(`/venues/${id}`, { status });
    } catch (err) {
      mutate((prev) => (prev ? { ...prev, status: previous } : prev));
      setStatusError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setPendingStatus(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonText className="mb-6 h-6 w-48" />
        <SkeletonDetailCard fields={4} />
        <Card>
          <SkeletonText className="mb-4 h-4 w-24" />
          <SkeletonText className="h-4 w-full" />
        </Card>
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!venue) return null;

  const units = resources ?? [];
  const open = units.filter((u) => u.isBookable).length;
  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'units', label: 'Units', count: units.length },
    { key: 'settings', label: 'Settings' },
    { key: 'terms', label: 'Commercial terms' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/venues', label: 'Venues' }}
        title={venue.name}
        subtitle={`${venue.facilityCode} · ${venue.address}`}
        action={
          <Link
            href={`/owners/${venue.organizationId}`}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-gray-300 transition-colors hover:bg-gray-50"
          >
            Owner organization →
          </Link>
        }
      />

      <Card>
        {statusError && (
          <div className="mb-3">
            <ErrorBanner message={statusError} />
          </div>
        )}
        <VenueStatusPicker current={venue.status} allowed={STATUSES} busy={pendingStatus !== null} onPick={updateStatus} />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Units" value={units.length} icon="venue" />
        <StatCard label="Open for booking" value={`${open} of ${units.length}`} icon="calendar" tone="sky" />
        <StatCard label="Facilities" value={venue.facilities.length} icon="venue" tone="amber" />
        <StatCard
          label="Booked ahead up to"
          value={`${venue.advanceBookingDays} day${venue.advanceBookingDays === 1 ? '' : 's'}`}
          icon="calendar"
          tone="violet"
        />
      </div>

      <div>
        <div role="tablist" aria-label="Venue sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`venue-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls="venue-tabpanel"
              onClick={() => setTab(t.key)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1 text-xs font-normal text-gray-500">{t.count}</span>}
            </button>
          ))}
        </div>

        <div id="venue-tabpanel" role="tabpanel" aria-labelledby={`venue-tab-${tab}`}>
          {tab === 'units' && <UnitsPanel venue={venue} units={units} onChanged={refetchResources} />}
          {tab === 'settings' && (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
              <Card className="lg:col-span-2">
                <h2 className="mb-4 text-sm font-semibold text-gray-900">Venue details</h2>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Address</dt>
                    <dd className="mt-0.5">{venue.address}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Description</dt>
                    <dd className="mt-0.5">{venue.description || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Facilities</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">
                      {venue.facilities.length > 0 ? (
                        venue.facilities.map((f) => (
                          <span
                            key={f.id}
                            className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-600/20"
                          >
                            {f.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500">None yet. Add a unit first.</span>
                      )}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-gray-500">Timezone</dt>
                      <dd className="mt-0.5">{venue.timezone}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Start times every</dt>
                      <dd className="mt-0.5">{venue.defaultSlotGranularityMinutes} min</dd>
                    </div>
                  </div>
                </dl>
              </Card>
              <div className="space-y-6 lg:col-span-3">
                <VenueMapLink venueId={venue.id} link={venue.googleMapsUrl} onSaved={(googleMapsUrl) => mutate((v) => (v ? { ...v, googleMapsUrl } : v))} />
                <VenueAdvanceBooking
                  venueId={venue.id}
                  days={venue.advanceBookingDays}
                  onSaved={(advanceBookingDays) => mutate((v) => (v ? { ...v, advanceBookingDays } : v))}
                />
              </div>
            </div>
          )}
          {tab === 'terms' && <VenueTermsSection venueId={id} />}
        </div>
      </div>
    </div>
  );
}

/** The venue's units grouped by facility, searchable, with "Add unit" opening a dialog. */
function UnitsPanel({ venue, units: allUnits, onChanged }: { venue: Venue; units: Resource[]; onChanged: () => void }) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);

  // A switch shows at once: this holds what was just flipped until the list is read again, and is dropped if the server refuses.
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  useEffect(() => setFlipped({}), [allUnits]);
  const units = useMemo(() => allUnits.map((u) => (u.id in flipped ? { ...u, isBookable: flipped[u.id]! } : u)), [allUnits, flipped]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? units.filter((u) => [u.name, u.groundType, u.category.name].some((t) => t.toLowerCase().includes(q))) : units;
  }, [units, search]);

  async function setUnitBookable(resourceId: string, isBookable: boolean) {
    setUnitError(null);
    setFlipped((f) => ({ ...f, [resourceId]: isBookable }));
    try {
      await api.patch(`/resources/${resourceId}`, { isBookable });
      onChanged();
    } catch (err) {
      setFlipped((f) => {
        const { [resourceId]: _gone, ...rest } = f;
        return rest;
      });
      setUnitError(err instanceof ApiError ? err.message : 'Failed to update the unit');
    }
  }

  async function setFacilityBookable(categoryId: string, isBookable: boolean) {
    setUnitError(null);
    const ids = allUnits.filter((u) => u.category.id === categoryId).map((u) => u.id);
    setFlipped((f) => ({ ...f, ...Object.fromEntries(ids.map((i) => [i, isBookable])) }));
    try {
      await api.patch('/resources/facility-bookable', { venueId: venue.id, categoryId, isBookable });
      onChanged();
    } catch (err) {
      setFlipped((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !ids.includes(k))));
      setUnitError(err instanceof ApiError ? err.message : 'Failed to update the facility');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <ListToolbar
            active={search !== ''}
            total={shown.length}
            noun="unit"
            onClear={() => setSearch('')}
            search={<SearchBox label="Search units" placeholder="Search name, type or facility…" value={search} onChange={setSearch} />}
          />
        </div>
        <Button type="button" onClick={() => setAdding(true)}>
          + Add unit
        </Button>
      </div>

      {unitError && <ErrorBanner message={unitError} />}

      {units.length === 0 && (
        <Card>
          <EmptyState message="No units yet. Add the first pitch, court or lane customers can book." />
        </Card>
      )}
      {units.length > 0 && shown.length === 0 && (
        <Card>
          <p className="text-sm text-gray-500">No units match your search.</p>
        </Card>
      )}

      {venue.facilities.map((facility) => {
        const all = units.filter((r) => r.category.id === facility.id);
        const mine = shown.filter((r) => r.category.id === facility.id);
        if (mine.length === 0) return null;
        const openCount = all.filter((u) => u.isBookable).length;
        const allBlocked = all.every((u) => !u.isBookable);
        return (
          <Card key={facility.id} className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900">{facility.name}</h2>
                <p className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                  <span
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-red-200"
                    role="img"
                    aria-label={`${openCount} of ${all.length} open for booking`}
                  >
                    <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(openCount / all.length) * 100}%` }} />
                  </span>
                  {openCount} of {all.length} {plural(facility.unitLabel.toLowerCase(), all.length)} open
                </p>
              </div>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => setFacilityBookable(facility.id, allBlocked)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
                  allBlocked
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/30 hover:bg-emerald-100'
                    : 'bg-red-50 text-red-700 ring-red-600/30 hover:bg-red-100'
                }`}
              >
                {busyKey === `facility:${facility.id}` ? 'Saving…' : allBlocked ? 'Reopen all' : 'Block all'}
              </button>
            </div>
            <UnitsTable
              unitLabel={facility.unitLabel}
              units={mine}
              busy={busyKey !== null}
              onToggle={(unit) => setUnitBookable(unit.id, !unit.isBookable)}
            />
          </Card>
        );
      })}

      {adding && (
        <Modal title="Add unit" subtitle="A pitch, court, lane or table that customers can book." onClose={() => setAdding(false)}>
          <AddUnitForm
            venueId={venue.id}
            nextOrder={units.length}
            onCancel={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              onChanged();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/** The form inside the "Add unit" dialog: facility, name, type and the unit's shortest and longest booking. */
function AddUnitForm({
  venueId,
  nextOrder,
  onCancel,
  onAdded,
}: {
  venueId: string;
  nextOrder: number;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const { data: categories } = useFetch<VenueCategory[]>('/categories');
  const [form, setForm] = useState({ categoryId: '', name: '', groundType: '', isBookable: true });
  // The new unit's shortest and longest booking; they start from the chosen facility's own values.
  const [newDurations, setNewDurations] = useState({ min: 60, max: 180 });
  const [durationErrors, setDurationErrors] = useState<FieldErrors<'min' | 'max'>>({});
  const [errors, setErrors] = useState<FieldErrors<'categoryId' | 'name' | 'groundType'>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedCategory = categories?.find((c) => c.id === form.categoryId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const needsType = !!selectedCategory && selectedCategory.unitTypes.length > 0;
    const found: FieldErrors<'categoryId' | 'name' | 'groundType'> = {
      categoryId: selectedCategory ? undefined : 'Select a facility.',
      name: selectedCategory ? textError(form.name, `${selectedCategory.unitLabel} name`, 1, 100) : undefined,
      groundType: needsType && !form.groundType.trim() ? `Select the ${selectedCategory.unitLabel.toLowerCase()} type.` : undefined,
    };
    setErrors(found);
    const durationFound: FieldErrors<'min' | 'max'> = {};
    if (selectedCategory) {
      const { min, max } = newDurations;
      if (!Number.isInteger(min) || min <= 0 || min > 1440) durationFound.min = 'Enter the shortest booking in minutes (1 to 1440).';
      else if (!Number.isInteger(max) || max < min || max % min !== 0) durationFound.max = `The longest booking must be a multiple of ${min} minutes.`;
    }
    setDurationErrors(durationFound);
    if (hasErrors(durationFound)) {
      document.getElementById(durationFound.min ? 'unit-min' : 'unit-max')?.focus();
      return;
    }
    if (hasErrors(found)) {
      const first = (['categoryId', 'name', 'groundType'] as const).find((k) => found[k]);
      document.getElementById('unit-' + first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/resources', {
        venueId,
        ...form,
        minDurationMinutes: newDurations.min,
        maxDurationMinutes: newDurations.max,
        sortOrder: nextOrder,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create resource');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {error && (
        <div className="sm:col-span-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div>
        <Label htmlFor="unit-categoryId">Facility</Label>
        <Select
          id="unit-categoryId"
          aria-invalid={!!errors.categoryId}
          className={errors.categoryId ? invalidClass : ''}
          value={form.categoryId}
          onChange={(e) => {
            setErrors({});
            setDurationErrors({});
            const picked = categories?.find((c) => c.id === e.target.value);
            if (picked) {
              const { minDurationMin, maxDurationMin } = picked.policy;
              setNewDurations({ min: minDurationMin, max: Math.max(minDurationMin, Math.floor(maxDurationMin / minDurationMin) * minDurationMin) });
            }
            setForm((f) => ({ ...f, categoryId: e.target.value, groundType: '' }));
          }}
        >
          <option value="">Select facility…</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <FieldError id="unit-categoryId-error" message={errors.categoryId} />
      </div>
      <div>
        <Label htmlFor="unit-name">{selectedCategory?.unitLabel ?? 'Unit'} name</Label>
        <Input
          id="unit-name"
          aria-invalid={!!errors.name}
          className={errors.name ? invalidClass : ''}
          disabled={!selectedCategory}
          placeholder={`e.g. ${selectedCategory?.unitLabel ?? 'Unit'} 1`}
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            setErrors((p) => ({ ...p, name: undefined }));
          }}
        />
        <FieldError id="unit-name-error" message={errors.name} />
      </div>
      {selectedCategory && selectedCategory.unitTypes.length > 0 && (
        <div className="sm:col-span-2">
          <Label htmlFor="unit-groundType">{selectedCategory.unitLabel} type</Label>
          <Select
            id="unit-groundType"
            aria-invalid={!!errors.groundType}
            className={errors.groundType ? invalidClass : ''}
            value={form.groundType}
            onChange={(e) => {
              setForm((f) => ({ ...f, groundType: e.target.value }));
              setErrors((p) => ({ ...p, groundType: undefined }));
            }}
          >
            <option value="">Select type…</option>
            {selectedCategory.unitTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <FieldError id="unit-groundType-error" message={errors.groundType} />
        </div>
      )}
      {selectedCategory && (
        <>
          <div>
            <Label htmlFor="unit-min">Shortest booking (minutes)</Label>
            <Input
              id="unit-min"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              aria-invalid={!!durationErrors.min}
              className={durationErrors.min ? invalidClass : ''}
              value={Number.isFinite(newDurations.min) ? newDurations.min : ''}
              onChange={(e) => {
                const min = Number(e.target.value);
                setDurationErrors({});
                setNewDurations((d) => ({ min, max: Number.isInteger(min) && min > 0 ? Math.max(min, Math.floor(d.max / min) * min) : d.max }));
              }}
            />
            <p className="mt-1 text-xs text-gray-500">Prices are per block of this length.</p>
            <FieldError id="unit-min-error" message={durationErrors.min} />
          </div>
          <div>
            <Label htmlFor="unit-max">Longest booking (minutes)</Label>
            <Select
              id="unit-max"
              aria-invalid={!!durationErrors.max}
              className={durationErrors.max ? invalidClass : ''}
              value={String(newDurations.max)}
              onChange={(e) => setNewDurations((d) => ({ ...d, max: Number(e.target.value) }))}
            >
              {Array.from(
                { length: Number.isInteger(newDurations.min) && newDurations.min > 0 ? Math.min(24, Math.floor(1440 / newDurations.min)) : 0 },
                (_, i) => (i + 1) * newDurations.min,
              ).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <FieldError id="unit-max-error" message={durationErrors.max} />
          </div>
        </>
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
          {submitting ? 'Adding…' : 'Add unit'}
        </Button>
      </div>
    </form>
  );
}

/** On = customers can book this unit; Off = blocked from new bookings (existing ones stay). */
function BookToggle({
  on,
  busy,
  label,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onToggle}
      className="inline-flex items-center gap-2 disabled:opacity-60"
    >
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-red-400'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <span className={`text-xs font-medium ${on ? 'text-emerald-700' : 'text-red-700'}`}>{on ? 'Open' : 'Blocked'}</span>
    </button>
  );
}

const STATUS_STYLE: Record<string, { chip: string; dot: string; hint: string }> = {
  ACTIVE: {
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/40',
    dot: 'bg-emerald-500',
    hint: 'Live. Customers can find and book this venue.',
  },
  DRAFT: {
    chip: 'bg-slate-100 text-slate-700 ring-slate-400/50',
    dot: 'bg-slate-400',
    hint: 'Being set up. Hidden from customers.',
  },
  INACTIVE: {
    chip: 'bg-amber-50 text-amber-800 ring-amber-500/40',
    dot: 'bg-amber-500',
    hint: 'Paused. Hidden from customers; existing bookings are untouched.',
  },
  SUSPENDED: {
    chip: 'bg-red-50 text-red-800 ring-red-500/40',
    dot: 'bg-red-500',
    hint: 'Suspended by the platform. Contact support to reopen.',
  },
};

/** The four venue statuses as coloured chips: the current one is filled, the ones you can switch to are clickable. */
function VenueStatusPicker({
  current,
  allowed,
  busy,
  onPick,
}: {
  current: string;
  allowed: string[];
  busy: boolean;
  onPick: (status: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Status</p>
        <p className="mt-0.5 text-xs text-gray-500">{STATUS_STYLE[current]?.hint}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Venue status">
        {Object.entries(STATUS_STYLE).map(([status, st]) => {
          const isCurrent = status === current;
          const canPick = !isCurrent && allowed.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isCurrent}
              disabled={busy || !canPick}
              title={isCurrent ? 'Current status' : canPick ? `Set to ${status}` : 'Only the platform can set this'}
              onClick={() => onPick(status)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                isCurrent
                  ? `${st.chip} ring-2`
                  : canPick
                    ? `bg-white ring-gray-300 hover:bg-gray-50 text-gray-500 ring-1 ring-inset`
                    : `bg-transparent text-gray-500 opacity-50 ring-1 ring-inset ring-transparent`
              } disabled:cursor-not-allowed`}
            >
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {status}
              {isCurrent && <span aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "pitch" -> "pitches", "court" -> "courts". */
function plural(word: string, count: number) {
  if (count === 1) return word;
  return /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

const UNITS_PAGE = 10;

/** One facility's units, ten at a time (a venue can have dozens of courts or lanes). */
function UnitsTable({
  unitLabel,
  units,
  busy,
  onToggle,
}: {
  unitLabel: string;
  units: Resource[];
  busy: boolean;
  onToggle: (unit: Resource) => void;
}) {
  const page = usePageSlice(units, UNITS_PAGE, units.length);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-2.5">Name</th>
              <th className="px-5 py-2.5">{unitLabel} type</th>
              <th className="px-5 py-2.5">Booking length</th>
              <th className="px-5 py-2.5">Booking</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 transition-colors hover:bg-brand-50/40">
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="px-5 py-3">{r.groundType || '—'}</td>
                <td className="px-5 py-3 text-gray-600">
                  {r.minDurationMinutes} min{r.maxDurationMinutes > r.minDurationMinutes ? ` – ${r.maxDurationMinutes} min` : ''}
                </td>
                <td className="px-5 py-3">
                  <BookToggle
                    on={r.isBookable}
                    busy={busy}
                    label={`${r.isBookable ? 'Block' : 'Reopen'} ${r.name}`}
                    onToggle={() => onToggle(r)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page.page} pageSize={UNITS_PAGE} total={page.total} onPage={page.setPage} />
    </>
  );
}
