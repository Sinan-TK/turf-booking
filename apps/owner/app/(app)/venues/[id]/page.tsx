'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import type { VenueCategory, VenueCategorySummary } from '@/lib/categories';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SvgIcon } from '@/components/svg-icons';
import { VenueMapLink } from '@/components/venue-map-link';
import { VenueAdvanceBooking } from '@/components/venue-advance-booking';
import { VenueAvailability } from '@/components/venue-availability';
import { VenuePooledGroups } from '@/components/venue-pooled-groups';
import { UnitPhotos, type UnitPhoto } from '@/components/unit-photos';
import { DurationFields, UnitDurations, defaultDurations, durationsError } from '@/components/unit-durations';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  FieldError,
  Input,
  Label,
  LoadingState,
  Select,
  invalidClass,
} from '@/components/ui';
import { hasErrors, textError, type FieldErrors } from '@/lib/validation';

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
  /** Shortest and longest booking, in minutes. The unit's prices are per block of the shortest. */
  minDurationMinutes: number;
  maxDurationMinutes: number;
  /** Up to three, main photo first: what customers see on the venue card. */
  photos: UnitPhoto[];
}

// Going live (ACTIVE), being suspended (SUSPENDED) and DRAFT are platform
// actions reserved for Super Admin — see VenuesService.OWNER_ALLOWED_STATUSES.
// An owner can only pause their venue (INACTIVE); the backend would reject
// anything else from a VENUE_OWNER anyway, this just avoids showing a
// control that would always 403.
const OWNER_STATUSES = ['INACTIVE'];

// Draft and Suspended are the platform's own states, so owners only see them when a venue is in one.
const OWNER_VISIBLE_STATUSES = ['ACTIVE', 'INACTIVE'];

/** What the owner is about to do, waiting on the confirmation dialog. */
type Pending =
  | { kind: 'status'; status: string }
  | { kind: 'unit'; unit: Resource; open: boolean }
  | { kind: 'facility'; facility: VenueCategorySummary; units: Resource[]; open: boolean };

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, refetch } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources } = useFetch<Resource[]>(
    `/resources?venueId=${id}`,
  );
  const { data: categories } = useFetch<VenueCategory[]>('/categories');

  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [resourceForm, setResourceForm] = useState({ categoryId: '', name: '', groundType: '' });
  // The new unit's shortest and longest booking; they start from the chosen facility's own values.
  const [newDurations, setNewDurations] = useState({ min: 60, max: 180 });
  const [durationErrors, setDurationErrors] = useState<{ min?: string; max?: string }>({});
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [unitErrors, setUnitErrors] = useState<FieldErrors<'categoryId' | 'name' | 'groundType'>>({});
  const [resourceSubmitting, setResourceSubmitting] = useState(false);

  const selectedCategory = categories?.find((c) => c.id === resourceForm.categoryId);
  // Only a facility with a preset list of types asks which one; the others have no type at all.
  const hasTypes = !!selectedCategory && selectedCategory.unitTypes.length > 0;

  function ask(next: Pending) {
    setDialogError(null);
    setPending(next);
  }

  async function confirm() {
    if (!pending) return;
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (pending.kind === 'status') {
        await api.patch(`/venues/${id}`, { status: pending.status });
        refetch();
      } else if (pending.kind === 'unit') {
        await api.patch(`/resources/${pending.unit.id}`, { isBookable: pending.open });
        refetchResources();
      } else {
        await api.patch('/resources/facility-bookable', {
          venueId: id,
          categoryId: pending.facility.id,
          isBookable: pending.open,
        });
        refetchResources();
      }
      setPending(null);
    } catch (err) {
      setDialogError(
        err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.',
      );
    } finally {
      setDialogBusy(false);
    }
  }

  async function onCreateResource(e: React.FormEvent) {
    e.preventDefault();
    setResourceError(null);
    const found: FieldErrors<'categoryId' | 'name' | 'groundType'> = {
      categoryId: selectedCategory ? undefined : 'Select a facility.',
      name: selectedCategory ? textError(resourceForm.name, `${selectedCategory.unitLabel} name`, 1, 100) : undefined,
      groundType: hasTypes && !resourceForm.groundType.trim() ? `Select the ${selectedCategory.unitLabel.toLowerCase()} type.` : undefined,
    };
    setUnitErrors(found);
    const durationFound = selectedCategory ? durationsError(newDurations.min, newDurations.max) : {};
    setDurationErrors(durationFound);
    if (hasErrors(durationFound)) {
      document.getElementById(durationFound.min ? 'new-unit-min' : 'new-unit-max')?.focus();
      return;
    }
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
        minDurationMinutes: newDurations.min,
        maxDurationMinutes: newDurations.max,
        isBookable: true,
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

  if (loading) return <LoadingState />;
  if (error) return <ErrorBanner message={error} />;
  if (!venue) return null;

  const units = resources ?? [];
  const openUnits = units.filter((u) => u.isBookable).length;
  const dialog = pending ? describe(pending, venue) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-white p-container-padding shadow-sm ring-1 ring-outline-variant/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href="/venues"
              aria-label="Back to all venues"
              title="Back to all venues"
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant ring-1 ring-outline-variant/50 transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <SvgIcon name="back" className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-headline-md text-headline-md text-on-surface">{venue.name}</h1>
              {venue.description && (
                <p className="mt-0.5 text-body-md text-on-surface-variant">{venue.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body-md text-on-surface-variant">
                <Badge value={venue.status} />
                <span className="font-mono text-xs">{venue.facilityCode}</span>
                <span className="inline-flex items-center gap-1.5">
                  <SvgIcon name="pin" className="h-4 w-4" />
                  {venue.address}
                </span>
              </div>
            </div>
          </div>
          <a
            href="#pricing"
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Pricing &amp; availability ↓
          </a>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-card-gap lg:grid-cols-4">
        <Stat label="Facilities" value={venue.facilities.length} />
        <Stat label="Units" value={units.length} />
        <Stat label="Open for booking" value={openUnits} tone="good" />
        <Stat
          label="Blocked"
          value={units.length - openUnits}
          tone={units.length - openUnits > 0 ? 'bad' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {venue.facilities.map((facility) => {
            const own = units.filter((r) => r.category.id === facility.id);
            if (own.length === 0) return null;
            const allBlocked = own.every((u) => !u.isBookable);
            const open = own.filter((u) => u.isBookable).length;
            return (
              <section
                key={facility.id}
                className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30"
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
                  <div>
                    <h2 className="text-body-md font-semibold text-on-surface">{facility.name}</h2>
                    <p className="text-xs text-on-surface-variant">
                      {own.length} {plural(facility.unitLabel.toLowerCase(), own.length)} ·{' '}
                      <span className={open === 0 ? 'font-medium text-red-700' : undefined}>
                        {open === own.length ? 'all open' : `${open} open`}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      ask({ kind: 'facility', facility, units: own, open: allBlocked })
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                      allBlocked
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/30 hover:bg-emerald-100'
                        : 'bg-red-50 text-red-700 ring-red-600/30 hover:bg-red-100'
                    }`}
                  >
                    {allBlocked ? `Reopen ${facility.name}` : `Block ${facility.name}`}
                  </button>
                </header>
                <ul className="divide-y divide-outline-variant/20">
                  {own.map((r) => (
                    <li key={r.id} className="px-container-padding py-3.5">
                      <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                            r.isBookable
                              ? 'bg-primary-fixed-dim/25 text-on-primary-container'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {r.name.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-body-md font-medium text-on-surface">
                            {r.name}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {r.groundType
                              ? `${facility.unitLabel} type · ${r.groundType}`
                              : facility.unitLabel}
                          </p>
                        </div>
                      </div>
                      <BookToggle
                        on={r.isBookable}
                        label={`${r.isBookable ? 'Block' : 'Reopen'} ${r.name}`}
                        onToggle={() => ask({ kind: 'unit', unit: r, open: !r.isBookable })}
                      />
                      </div>
                      <div className="space-y-3 pl-12">
                        <UnitDurations
                          unitId={r.id}
                          min={r.minDurationMinutes}
                          max={r.maxDurationMinutes}
                          hasPrices
                          onSaved={refetchResources}
                        />
                        <UnitPhotos unitId={r.id} unitName={r.name} initial={r.photos ?? []} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <VenuePooledGroups venueId={venue.id} categories={categories} />

          {units.length === 0 && (
            <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-md text-on-surface-variant">
              No units yet. Pick a facility below and add the first one.
            </div>
          )}

          <section className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
            <header className="flex items-center gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-light leading-none text-on-primary">
                +
              </span>
              <div>
                <h2 className="text-body-md font-semibold text-on-surface">Add a unit</h2>
                <p className="text-xs text-on-surface-variant">
                  A turf, a pool lane, a court… whatever customers can book.
                </p>
              </div>
            </header>
            <form onSubmit={onCreateResource} noValidate>
              <div className="space-y-6 p-container-padding">
                {resourceError && <ErrorBanner message={resourceError} />}

                <div
                  className={`grid grid-cols-1 gap-4 ${hasTypes ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
                >
                  <div>
                    <Label htmlFor="unit-categoryId">Facility</Label>
                    <Select
                      id="unit-categoryId"
                      aria-invalid={!!unitErrors.categoryId}
                      className={unitErrors.categoryId ? invalidClass : ''}
                      value={resourceForm.categoryId}
                      onChange={(e) => {
                        setUnitErrors({});
                        setDurationErrors({});
                        const picked = categories?.find((c) => c.id === e.target.value);
                        if (picked) {
                          const own = defaultDurations(picked.policy);
                          setNewDurations(own);
                        }
                        setResourceForm((f) => ({
                          ...f,
                          categoryId: e.target.value,
                          groundType: '',
                        }));
                      }}
                    >
                      <option value="">Select facility…</option>
                      {categories?.filter((c) => c.defaultAllocationMode !== 'POOLED').map((c) => (
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
                      placeholder={
                        selectedCategory
                          ? `e.g. ${selectedCategory.unitLabel} 1`
                          : 'Choose a facility first'
                      }
                      value={resourceForm.name}
                      onChange={(e) => {
                        setResourceForm((f) => ({ ...f, name: e.target.value }));
                        setUnitErrors((p) => ({ ...p, name: undefined }));
                      }}
                    />
                    <FieldError id="unit-name-error" message={unitErrors.name} />
                  </div>
                  {hasTypes && (
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
                </div>
                {selectedCategory && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <DurationFields idPrefix="new-unit" min={newDurations.min} max={newDurations.max} onChange={setNewDurations} errors={durationErrors} />
                  </div>
                )}
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
                <p className="text-xs text-on-surface-variant">
                  {selectedCategory
                    ? `It will be added to ${selectedCategory.name} at this venue, open for booking.`
                    : 'Pick a facility to get started.'}
                </p>
                <Button
                  type="submit"
                  disabled={resourceSubmitting}
                  className="inline-flex items-center gap-2 px-5"
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    +
                  </span>
                  {resourceSubmitting
                    ? 'Adding…'
                    : `Add ${(selectedCategory?.unitLabel ?? 'unit').toLowerCase()}`}
                </Button>
              </footer>
            </form>
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="text-body-md font-semibold text-on-surface">Venue status</h2>
            <p className="mb-4 mt-0.5 text-xs text-on-surface-variant">
              You can pause your venue. Making it live again is done by the platform.
            </p>
            <VenueStatusPicker
              current={venue.status}
              allowed={OWNER_STATUSES}
              busy={dialogBusy}
              onPick={(status) => ask({ kind: 'status', status })}
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-body-md font-semibold text-on-surface">Details</h2>
            <dl className="divide-y divide-outline-variant/20 text-body-md">
              <Row label="Facilities">
                {venue.facilities.length > 0 ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {venue.facilities.map((f) => (
                      <span
                        key={f.id}
                        className="rounded-full bg-primary-fixed-dim/20 px-2.5 py-0.5 text-xs font-medium text-on-primary-container"
                      >
                        {f.name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-on-surface-variant">None yet</span>
                )}
              </Row>
              <Row label="Timezone">{venue.timezone}</Row>
              <Row label="Slot length">{venue.defaultSlotGranularityMinutes} min (fixed)</Row>
              <Row label="Venue code">
                <span className="font-mono text-xs">{venue.facilityCode}</span>
              </Row>
            </dl>
            <div className="divide-y divide-outline-variant/20 border-t border-outline-variant/20">
              <VenueMapLink venueId={venue.id} link={venue.googleMapsUrl} onSaved={() => refetch()} />
              <VenueAdvanceBooking venueId={venue.id} days={venue.advanceBookingDays} onSaved={() => refetch()} />
            </div>
          </Card>
        </div>
      </div>

      <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-6 space-y-4">
        <div>
          <h2 id="pricing-heading" className="font-headline-md text-headline-md text-on-surface">
            Pricing &amp; availability
          </h2>
          <p className="mt-0.5 text-body-md text-on-surface-variant">
            What each unit costs and when it can be booked, the days you are closed, and bookings you take yourself.
          </p>
        </div>
        {categories ? (
          <VenueAvailability venueId={venue.id} resources={units} categories={categories} />
        ) : (
          <LoadingState />
        )}
      </section>

      {pending && dialog && (
        <ConfirmDialog
          title={dialog.title}
          confirmLabel={dialog.confirm}
          tone={dialog.tone}
          busy={dialogBusy}
          error={dialogError}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          {dialog.body}
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Wording for the confirmation dialog of each kind of change. */
function describe(
  p: Pending,
  venue: Venue,
): { title: string; body: React.ReactNode; confirm: string; tone: 'primary' | 'warn' | 'danger' } {
  if (p.kind === 'status') {
    return {
      title: `Pause ${venue.name}?`,
      tone: 'warn',
      confirm: 'Pause venue',
      body: (
        <>
          <p>Customers will no longer be able to find or book this venue.</p>
          <p>
            Bookings that are already made are not affected. Only the platform can make it live
            again.
          </p>
        </>
      ),
    };
  }
  if (p.kind === 'unit') {
    return p.open
      ? {
          title: `Reopen ${p.unit.name}?`,
          tone: 'primary',
          confirm: 'Reopen for booking',
          body: (
            <p>
              Customers will be able to book this {p.unit.category.unitLabel.toLowerCase()} again.
            </p>
          ),
        }
      : {
          title: `Block ${p.unit.name}?`,
          tone: 'danger',
          confirm: 'Block bookings',
          body: (
            <>
              <p>
                No new bookings can be made on this {p.unit.category.unitLabel.toLowerCase()},
                online or walk-in, until you reopen it.
              </p>
              <p>Bookings that are already made are not cancelled.</p>
            </>
          ),
        };
  }
  const count = p.units.length;
  const what = `${count} ${plural(p.facility.unitLabel.toLowerCase(), count)}`;
  return p.open
    ? {
        title: `Reopen ${p.facility.name}?`,
        tone: 'primary',
        confirm: 'Reopen all',
        body: <p>All {what} will accept bookings again.</p>,
      }
    : {
        title: `Block all of ${p.facility.name}?`,
        tone: 'danger',
        confirm: `Block ${count === 1 ? 'it' : `all ${count}`}`,
        body: (
          <>
            <p>
              None of the {what} can be booked until you reopen them. Your other facilities at this
              venue are not affected.
            </p>
            <p>Bookings that are already made are not cancelled.</p>
          </>
        ),
      };
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-on-surface';
  return (
    <Card className="p-4">
      <p className="font-label-md text-label-md uppercase text-on-surface-variant">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${color}`}>{value}</p>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-on-surface-variant">{label}</dt>
      <dd className="text-right text-on-surface">{children}</dd>
    </div>
  );
}

/** On = customers can book this unit; Off = blocked from new bookings (existing ones stay). */
function BookToggle({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="inline-flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className={`text-xs font-medium ${on ? 'text-emerald-700' : 'text-red-700'}`}>
        {on ? 'Open' : 'Blocked'}
      </span>
      <span
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-red-400'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
        />
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
        {Object.entries(STATUS_STYLE)
          .filter(([status]) => status === current || OWNER_VISIBLE_STATUSES.includes(status))
          .map(([status, st]) => {
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
                      ? 'bg-surface-container-lowest text-on-surface-variant ring-1 ring-inset ring-outline-variant/50 hover:bg-surface-container'
                      : 'bg-transparent text-on-surface-variant opacity-50 ring-1 ring-inset ring-transparent'
                } disabled:cursor-not-allowed`}
              >
                <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                {status}
                {isCurrent && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
      </div>
      <p className="mt-3 text-xs text-on-surface-variant">{STATUS_STYLE[current]?.hint}</p>
    </div>
  );
}

/** "pitch" -> "pitches", "court" -> "courts". */
function plural(word: string, count: number) {
  if (count === 1) return word;
  return /(s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}
