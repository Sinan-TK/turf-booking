'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import type { VenueCategory, VenueCategorySummary } from '@/lib/categories';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  PageHeader,
  Select,
  SkeletonDetailCard,
  SkeletonText,
  invalidClass,
} from '@/components/ui';
import { hasErrors, textError, type FieldErrors } from '@/lib/validation';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  description: string | null;
  address: string;
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
}

const STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, mutate } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources } = useFetch<Resource[]>(
    `/resources?venueId=${id}`,
  );
  const { data: categories } = useFetch<VenueCategory[]>('/categories');

  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [resourceForm, setResourceForm] = useState({
    categoryId: '',
    name: '',
    groundType: '',
    isBookable: true,
  });
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceSubmitting, setResourceSubmitting] = useState(false);
  const [unitErrors, setUnitErrors] = useState<FieldErrors<'categoryId' | 'name' | 'groundType'>>({});
  const [linkErrors, setLinkErrors] = useState<FieldErrors<'parent' | 'child'>>({});

  const [composition, setComposition] = useState({ parentResourceId: '', childResourceId: '' });
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const [compositionSubmitting, setCompositionSubmitting] = useState(false);

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

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);

  async function setUnitBookable(resourceId: string, isBookable: boolean) {
    setUnitError(null);
    setBusyKey(resourceId);
    try {
      await api.patch(`/resources/${resourceId}`, { isBookable });
      refetchResources();
    } catch (err) {
      setUnitError(err instanceof ApiError ? err.message : 'Failed to update the unit');
    } finally {
      setBusyKey(null);
    }
  }

  async function setFacilityBookable(categoryId: string, isBookable: boolean) {
    setUnitError(null);
    setBusyKey(`facility:${categoryId}`);
    try {
      await api.patch('/resources/facility-bookable', { venueId: id, categoryId, isBookable });
      refetchResources();
    } catch (err) {
      setUnitError(err instanceof ApiError ? err.message : 'Failed to update the facility');
    } finally {
      setBusyKey(null);
    }
  }

  const selectedCategory = categories?.find((c) => c.id === resourceForm.categoryId);

  async function onCreateResource(e: React.FormEvent) {
    e.preventDefault();
    setResourceError(null);
    const needsType = !!selectedCategory && selectedCategory.unitTypes.length > 0;
    const found: FieldErrors<'categoryId' | 'name' | 'groundType'> = {
      categoryId: selectedCategory ? undefined : 'Select a facility.',
      name: selectedCategory ? textError(resourceForm.name, `${selectedCategory.unitLabel} name`, 1, 100) : undefined,
      groundType: needsType && !resourceForm.groundType.trim() ? `Select the ${selectedCategory.unitLabel.toLowerCase()} type.` : undefined,
    };
    setUnitErrors(found);
    if (hasErrors(found)) {
      const first = (['categoryId', 'name', 'groundType'] as const).find((k) => found[k]);
      document.getElementById('unit-' + first)?.focus();
      return;
    }
    setResourceSubmitting(true);
    try {
      await api.post('/resources', {
        venueId: id,
        ...resourceForm,
        sortOrder: resources?.length ?? 0,
      });
      setResourceForm((f) => ({ ...f, name: '', groundType: '' }));
      setUnitErrors({});
      refetchResources();
    } catch (err) {
      setResourceError(err instanceof ApiError ? err.message : 'Failed to create resource');
    } finally {
      setResourceSubmitting(false);
    }
  }

  async function onCreateComposition(e: React.FormEvent) {
    e.preventDefault();
    setCompositionError(null);
    const found: FieldErrors<'parent' | 'child'> = {
      parent: composition.parentResourceId ? undefined : 'Select the parent unit.',
      child: !composition.childResourceId
        ? 'Select the child unit.'
        : composition.childResourceId === composition.parentResourceId
          ? 'A unit can’t be part of itself. Pick a different child.'
          : undefined,
    };
    setLinkErrors(found);
    if (hasErrors(found)) {
      document.getElementById(found.parent ? 'link-parent' : 'link-child')?.focus();
      return;
    }
    setCompositionSubmitting(true);
    try {
      await api.post('/resources/compositions', composition);
      setComposition({ parentResourceId: '', childResourceId: '' });
      refetchResources();
    } catch (err) {
      setCompositionError(err instanceof ApiError ? err.message : 'Failed to link resources');
    } finally {
      setCompositionSubmitting(false);
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

  return (
    <div className="space-y-6">
      <PageHeader title={venue.name} />

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-sm text-gray-500">{venue.facilityCode}</span>
          <Badge value={venue.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Address</dt>
            <dd>{venue.address}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Facilities</dt>
            <dd className="flex flex-wrap gap-1.5">
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
                <span className="text-gray-500">None yet. Add a unit below.</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Timezone</dt>
            <dd>{venue.timezone}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Slot Granularity</dt>
            <dd>{venue.defaultSlotGranularityMinutes} min (fixed)</dd>
          </div>
          <div>
            <dt className="text-gray-500">Description</dt>
            <dd>{venue.description || '—'}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <Label>Change Status</Label>
          {statusError && (
            <div className="mb-2">
              <ErrorBanner message={statusError} />
            </div>
          )}
          <VenueStatusPicker
            current={venue.status}
            allowed={STATUSES}
            busy={pendingStatus !== null}
            onPick={updateStatus}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Facilities &amp; units</h2>
        {unitError && (
          <div className="mb-4">
            <ErrorBanner message={unitError} />
          </div>
        )}
        {resources && resources.length > 0 ? (
          <div className="mb-6 space-y-6">
            {venue.facilities.map((facility) => {
              const units = resources.filter((r) => r.category.id === facility.id);
              if (units.length === 0) return null;
              return (
                <div key={facility.id}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-gray-900">
                      {facility.name}{' '}
                      <span className="font-normal text-gray-500">
                        · {units.length} {plural(facility.unitLabel.toLowerCase(), units.length)}
                      </span>
                    </h3>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={() =>
                        setFacilityBookable(
                          facility.id,
                          units.every((u) => !u.isBookable),
                        )
                      }
                      className={`rounded-lg px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
                        units.every((u) => !u.isBookable)
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/30 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-700 ring-red-600/30 hover:bg-red-100'
                      }`}
                    >
                      {busyKey === `facility:${facility.id}`
                        ? 'Saving…'
                        : units.every((u) => !u.isBookable)
                          ? 'Reopen all'
                          : 'Block all'}
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="py-2">Name</th>
                          <th className="py-2">{facility.unitLabel} type</th>
                          <th className="py-2">Booking</th>
                        </tr>
                      </thead>
                      <tbody>
                        {units.map((r) => (
                          <tr key={r.id} className="border-b border-gray-100 last:border-0">
                            <td className="py-2 font-medium">{r.name}</td>
                            <td className="py-2">{r.groundType || '—'}</td>
                            <td className="py-2">
                              <BookToggle
                                on={r.isBookable}
                                busy={busyKey !== null}
                                label={`${r.isBookable ? 'Block' : 'Reopen'} ${r.name}`}
                                onToggle={() => setUnitBookable(r.id, !r.isBookable)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mb-6 text-sm text-gray-500">
            No units yet. Pick a facility below and add the first one.
          </p>
        )}

        <form onSubmit={onCreateResource} noValidate className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
          {resourceError && (
            <div className="sm:col-span-4">
              <ErrorBanner message={resourceError} />
            </div>
          )}
          <div>
            <Label htmlFor="unit-categoryId">Facility</Label>
            <Select
              id="unit-categoryId"
              aria-invalid={!!unitErrors.categoryId}
              className={unitErrors.categoryId ? invalidClass : ''}
              value={resourceForm.categoryId}
              onChange={(e) => {
                setUnitErrors({});
                setResourceForm((f) => ({ ...f, categoryId: e.target.value, groundType: '' }));
              }}
            >
              <option value="">Select facility…</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <FieldError id="unit-categoryId-error" message={unitErrors.categoryId} />
          </div>
          <div>
            <Label htmlFor="unit-name">{selectedCategory?.unitLabel ?? 'Unit'} name</Label>
            <Input
              id="unit-name"
              aria-invalid={!!unitErrors.name}
              className={unitErrors.name ? invalidClass : ''}
              disabled={!selectedCategory}
              placeholder={`e.g. ${selectedCategory?.unitLabel ?? 'Unit'} 1`}
              value={resourceForm.name}
              onChange={(e) => {
                setResourceForm((f) => ({ ...f, name: e.target.value }));
                setUnitErrors((p) => ({ ...p, name: undefined }));
              }}
            />
            <FieldError id="unit-name-error" message={unitErrors.name} />
          </div>
          {selectedCategory && selectedCategory.unitTypes.length > 0 && (
            <div>
              <Label htmlFor="unit-groundType">{selectedCategory.unitLabel} type</Label>
              <Select
                id="unit-groundType"
                aria-invalid={!!unitErrors.groundType}
                className={unitErrors.groundType ? invalidClass : ''}
                value={resourceForm.groundType}
                onChange={(e) => {
                  setResourceForm((f) => ({ ...f, groundType: e.target.value }));
                  setUnitErrors((p) => ({ ...p, groundType: undefined }));
                }}
              >
                <option value="">Select type…</option>
                {selectedCategory.unitTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <FieldError id="unit-groundType-error" message={unitErrors.groundType} />
            </div>
          )}
          <Button type="submit" loading={resourceSubmitting}>
            {resourceSubmitting ? 'Adding…' : 'Add unit'}
          </Button>
        </form>

        {resources && resources.length >= 2 && (
          <form
            onSubmit={onCreateComposition}
            noValidate
            className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3"
          >
            {compositionError && (
              <div className="col-span-3">
                <ErrorBanner message={compositionError} />
              </div>
            )}
            <div>
              <Label htmlFor="link-parent">Parent (contains the child, same facility)</Label>
              <Select
                id="link-parent"
                aria-invalid={!!linkErrors.parent}
                className={linkErrors.parent ? invalidClass : ''}
                value={composition.parentResourceId}
                onChange={(e) => {
                  setComposition((c) => ({ ...c, parentResourceId: e.target.value }));
                  setLinkErrors({});
                }}
              >
                <option value="">Select…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.category.name})
                  </option>
                ))}
              </Select>
              <FieldError id="link-parent-error" message={linkErrors.parent} />
            </div>
            <div>
              <Label htmlFor="link-child">Child (part of the parent)</Label>
              <Select
                id="link-child"
                aria-invalid={!!linkErrors.child}
                className={linkErrors.child ? invalidClass : ''}
                value={composition.childResourceId}
                onChange={(e) => {
                  setComposition((c) => ({ ...c, childResourceId: e.target.value }));
                  setLinkErrors({});
                }}
              >
                <option value="">Select…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.category.name})
                  </option>
                ))}
              </Select>
              <FieldError id="link-child-error" message={linkErrors.child} />
            </div>
            <Button type="submit" loading={compositionSubmitting}>
              {compositionSubmitting ? 'Linking…' : 'Link as Composition'}
            </Button>
          </form>
        )}
      </Card>
    </div>
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
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-red-400'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
      <span className={`text-xs font-medium ${on ? 'text-emerald-700' : 'text-red-700'}`}>
        {on ? 'Open' : 'Blocked'}
      </span>
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
    <div>
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
              title={
                isCurrent
                  ? 'Current status'
                  : canPick
                    ? `Set to ${status}`
                    : 'Only the platform can set this'
              }
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
      <p className="mt-2 text-xs text-gray-500">{STATUS_STYLE[current]?.hint}</p>
    </div>
  );
}

/** "pitch" -> "pitches", "court" -> "courts". */
function plural(word: string, count: number) {
  if (count === 1) return word;
  return /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}
