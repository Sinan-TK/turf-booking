'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import type { VenueCategory, VenueCategorySummary } from '@/lib/categories';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SvgIcon } from '@/components/svg-icons';
import { FacilityIcon } from '@/components/facility-icon';
import { VenueMapLink } from '@/components/venue-map-link';
import { VenueAdvanceBooking } from '@/components/venue-advance-booking';
import { VenueContactPhone } from '@/components/venue-contact-phone';
import { UnitDescription } from '@/components/unit-description';
import { BlockedDatesSection, UnitTools } from '@/components/venue-availability';
import { AddPooledItem, GroupCard, type Group } from '@/components/venue-pooled-groups';
import { UnitPhotos, type UnitPhoto } from '@/components/unit-photos';
import { DurationFields, UnitDurations, defaultDurations, durationsError, type DurationLimits } from '@/components/unit-durations';
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
  contactPhone?: string | null;
  contactCall?: boolean;
  contactWhatsapp?: boolean;
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
  description?: string | null;
}

// An owner can pause their venue (INACTIVE) and make it live again (ACTIVE); DRAFT and SUSPENDED are platform actions reserved for Super Admin,
// and a venue in either of them can't be changed by its owner. See VenuesService.OWNER_ALLOWED_STATUSES: the backend rejects anything else,
// this just avoids showing a control that would always 403.
const OWNER_STATUSES = ['ACTIVE', 'INACTIVE'];

// Draft and Suspended are the platform's own states, so owners only see them when a venue is in one.
const OWNER_VISIBLE_STATUSES = ['ACTIVE', 'INACTIVE'];

/** What the owner is about to do, waiting on the confirmation dialog. */
type Pending =
  | { kind: 'status'; status: string }
  | { kind: 'unit'; unit: Resource; open: boolean }
  | { kind: 'facility'; facility: VenueCategorySummary; units: Resource[]; open: boolean };

/** The shortest and longest booking the Super Admin allows for a venue type: a unit's lengths must stay inside it. */
function limitsOf(category: VenueCategory | undefined): DurationLimits | undefined {
  return category ? { name: category.name, min: category.policy.minDurationMin, max: category.policy.maxDurationMin } : undefined;
}

/** The tab that holds the forms for adding a unit or a pooled item. */
const NEW_TAB = 'new';

/** The page's two sections: the venue itself, and its units. */
type Section = 'venue' | 'units';

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, refetch, mutate: mutateVenue } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources, mutate: mutateResources } = useFetch<Resource[]>(
    `/resources?venueId=${id}`,
  );
  const { data: groupRows, refetch: refetchGroups } = useFetch<Group[]>(`/resources/groups?venueId=${id}`);
  const { data: categories } = useFetch<VenueCategory[]>('/categories');
  const { data: terms } = useFetch<Array<{ categoryId: string; terms: { minAdvancePercent: number } }>>(`/owner/commercial-terms?venueId=${id}`);
  const minAdvance = Object.fromEntries((terms ?? []).map((t) => [t.categoryId, t.terms.minAdvancePercent]));

  const [section, setSection] = useState<Section>('venue');
  // The old pricing address (/venues/:id/availability) lands here as #pricing: it opens the Units tab.
  useEffect(() => {
    if (window.location.hash === '#pricing') setSection('units');
  }, []);
  // The open tab: a unit's or pooled item's id, or NEW_TAB. Empty until the first one is chosen (then the first unit is open).
  const [tab, setTab] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // A change the server refused after it was already shown: the screen is put back and this says why.
  const [actionError, setActionError] = useState<string | null>(null);

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

  /**
   * The owner confirmed: the dialog closes and the change shows at once (the switch flips, the status chip moves); if the server refuses
   * it the screen goes back and the reason is shown above.
   */
  async function confirm() {
    if (!pending) return;
    const change = pending;
    setPending(null);
    setActionError(null);
    if (change.kind === 'status') {
      await optimistic(mutateVenue, (v) => ({ ...v, status: change.status }), () => api.patch(`/venues/${id}`, { status: change.status }), setActionError);
      refetch();
    } else if (change.kind === 'unit') {
      await optimistic(mutateResources, (rs) => rs.map((r) => (r.id === change.unit.id ? { ...r, isBookable: change.open } : r)), () => api.patch(`/resources/${change.unit.id}`, { isBookable: change.open }), setActionError);
      refetchResources();
    } else {
      await optimistic(
        mutateResources,
        (rs) => rs.map((r) => (r.category.id === change.facility.id ? { ...r, isBookable: change.open } : r)),
        () => api.patch('/resources/facility-bookable', { venueId: id, categoryId: change.facility.id, isBookable: change.open }),
        setActionError,
      );
      refetchResources();
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
    const durationFound = selectedCategory ? durationsError(newDurations.min, newDurations.max, limitsOf(selectedCategory)) : {};
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
      const created = await api.post<{ id: string }>('/resources', {
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
      setTab(created.id); // the new unit's own tab opens, ready for its prices
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
  const groups = (groupRows ?? []).filter((g) => g.allocationMode === 'POOLED');
  const openUnits = units.filter((u) => u.isBookable).length;
  const dialog = pending ? describe(pending, venue) : null;

  const tabIds = [...units.map((u) => u.id), ...groups.map((g) => g.id), NEW_TAB];
  const activeTab = tabIds.includes(tab) ? tab : (tabIds[0] ?? NEW_TAB);
  const activeUnit = units.find((u) => u.id === activeTab);
  const activeGroup = groups.find((g) => g.id === activeTab);

  return (
    <div className="space-y-6">
      {actionError && (
        <div role="alert">
          <ErrorBanner message={actionError} />
        </div>
      )}

      {/* Who and where the venue is stays in view on both tabs. */}
      <section className="rounded-xl bg-white p-container-padding shadow-sm ring-1 ring-outline-variant/30">
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
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-body-md text-on-surface-variant">
              <Badge value={venue.status} />
              <span className="font-mono text-xs">{venue.facilityCode}</span>
              <span className="inline-flex items-center gap-1.5">
                <SvgIcon name="pin" className="h-4 w-4" />
                {venue.address}
              </span>
            </div>
          </div>
        </div>

      </section>

      <div role="tablist" aria-label="Venue sections" className="inline-flex max-w-full gap-1 rounded-xl bg-surface-container p-1">
        {(['venue', 'units'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`section-${s}`}
            aria-selected={section === s}
            aria-controls="section-panel"
            onClick={() => setSection(s)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-5 py-2 text-body-md font-semibold transition-colors ${
              section === s ? 'bg-surface-container-lowest text-primary shadow-sm ring-1 ring-primary/30' : 'text-on-surface/80 hover:bg-surface-container-high hover:text-on-surface'
            }`}
          >
            <SvgIcon name={s === 'venue' ? 'pin' : 'ball'} className="h-4 w-4" />
            {s === 'venue' ? 'Venue' : `Units (${units.length + groups.length})`}
          </button>
        ))}
      </div>

      <div id="section-panel" role="tabpanel" aria-labelledby={`section-${section}`} className="space-y-6">
      {section === 'venue' && (
        <>
      <section className="rounded-xl bg-white p-container-padding shadow-sm ring-1 ring-outline-variant/30">
        <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
          <div className="divide-y divide-outline-variant/20">
            <VenueMapLink venueId={venue.id} link={venue.googleMapsUrl} onSaved={() => refetch()} />
            <VenueAdvanceBooking venueId={venue.id} days={venue.advanceBookingDays} onSaved={() => refetch()} />
            <VenueContactPhone venueId={venue.id} phone={venue.contactPhone ?? null} call={venue.contactCall ?? true} whatsapp={venue.contactWhatsapp ?? false} onSaved={() => refetch()} />
          </div>
          <div className="divide-y divide-outline-variant/20">
            <div className="py-3">
              <h3 className="text-sm font-semibold text-on-surface">Venue status</h3>
              <p className="mb-3 mt-0.5 text-xs text-on-surface-variant">
                Pause your venue to hide it from customers, and make it live again whenever you like.
              </p>
              <VenueStatusPicker current={venue.status} allowed={OWNER_STATUSES} busy={dialogBusy} onPick={(status) => ask({ kind: 'status', status })} />
            </div>
            <dl className="py-1 text-body-md">
              <Row label="Facilities">
                {venue.facilities.length > 0 ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {venue.facilities.map((f) => (
                      <span key={f.id} className="rounded-full bg-primary-fixed-dim/20 px-2.5 py-0.5 text-xs font-medium text-on-primary-container">
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
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-card-gap lg:grid-cols-4">
        <Stat label="Facilities" value={venue.facilities.length} />
        <Stat label="Units" value={units.length} />
        <Stat label="Open for booking" value={openUnits} tone="good" />
        <Stat label="Blocked" value={units.length - openUnits} tone={units.length - openUnits > 0 ? 'bad' : undefined} />
      </div>

      {/* Closing the whole venue (every unit and pooled item) for some days is a venue setting, not a unit's. */}
      <BlockedDatesSection venueId={venue.id} scope={{ kind: 'venue' }} />
        </>
      )}

      {section === 'units' && (
        <>
      {/* One tab per unit and pooled item, each with everything it needs; the last tab adds a new one. */}
      <div>
        <div role="tablist" aria-label="Units" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-container p-1">
          {units.map((u) => (
            <UnitTab key={u.id} id={u.id} active={activeTab === u.id} onPick={setTab} title={u.name} sub={u.category.name} blocked={!u.isBookable} />
          ))}
          {groups.map((g) => (
            <UnitTab key={g.id} id={g.id} active={activeTab === g.id} onPick={setTab} title={g.name} sub={`${g.category.name} · ${g.totalUnits ?? 0}`} blocked={!g.isBookable} />
          ))}
          <button
            type="button"
            role="tab"
            id={`tab-${NEW_TAB}`}
            aria-selected={activeTab === NEW_TAB}
            aria-controls="unit-tab-panel"
            onClick={() => setTab(NEW_TAB)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-body-md font-medium transition-colors ${
              activeTab === NEW_TAB ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-primary hover:bg-surface-container-high'
            }`}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              +
            </span>
            New
          </button>
        </div>
      </div>

      <div id="unit-tab-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-6">
        {activeUnit && categories && (
          <UnitPanel
            unit={activeUnit}
            venueId={venue.id}
            categories={categories}
            minAdvance={minAdvance}
            sameFacility={units.filter((u) => u.category.id === activeUnit.category.id)}
            onAsk={ask}
            onChanged={refetchResources}
          />
        )}

        {activeGroup && (
          <>
            <GroupCard group={activeGroup} category={categories?.find((c) => c.id === activeGroup.category.id)} onChanged={refetchGroups} />
            <BlockedDatesSection key={activeGroup.id} venueId={venue.id} scope={{ kind: 'group', id: activeGroup.id, name: activeGroup.name }} />
          </>
        )}

        {activeTab === NEW_TAB && (
          <>
            {units.length + groups.length === 0 && (
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
                  <p className="text-xs text-on-surface-variant">A turf, a pool lane, a court… whatever customers can book.</p>
                </div>
              </header>
              <form onSubmit={onCreateResource} noValidate>
                <div className="space-y-6 p-container-padding">
                  {resourceError && <ErrorBanner message={resourceError} />}

                  <div className={`grid grid-cols-1 gap-4 ${hasTypes ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
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
                          setResourceForm((f) => ({ ...f, categoryId: e.target.value, groundType: '' }));
                        }}
                      >
                        <option value="">Select facility…</option>
                        {categories
                          ?.filter((c) => c.defaultAllocationMode !== 'POOLED')
                          .map((c) => (
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
                        placeholder={selectedCategory ? `e.g. ${selectedCategory.unitLabel} 1` : 'Choose a facility first'}
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
                      <DurationFields idPrefix="new-unit" min={newDurations.min} max={newDurations.max} onChange={setNewDurations} errors={durationErrors} limits={limitsOf(selectedCategory)} />
                    </div>
                  )}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
                  <p className="text-xs text-on-surface-variant">
                    {selectedCategory ? `It will be added to ${selectedCategory.name} at this venue, open for booking.` : 'Pick a facility to get started.'}
                  </p>
                  <Button type="submit" disabled={resourceSubmitting} className="inline-flex items-center gap-2 px-5">
                    <span aria-hidden="true" className="text-lg leading-none">
                      +
                    </span>
                    {resourceSubmitting ? 'Adding…' : `Add ${(selectedCategory?.unitLabel ?? 'unit').toLowerCase()}`}
                  </Button>
                </footer>
              </form>
            </section>

            <AddPooledItem
              venueId={venue.id}
              categories={categories}
              count={units.length + groups.length}
              onAdded={(newId) => {
                refetchGroups();
                if (newId) setTab(newId);
              }}
            />
          </>
        )}
      </div>
        </>
      )}
      </div>

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

/** One tab of the strip: the unit's (or pooled item's) name, its facility under it, and a red dot while it is blocked. */
function UnitTab({ id, active, onPick, title, sub, blocked }: { id: string; active: boolean; onPick: (id: string) => void; title: string; sub: string; blocked: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls="unit-tab-panel"
      onClick={() => onPick(id)}
      className={`flex shrink-0 flex-col items-start whitespace-nowrap rounded-lg px-4 py-1.5 text-left transition-colors ${
        active ? 'bg-surface-container-lowest text-on-surface shadow-sm ring-1 ring-primary/30' : 'text-on-surface/80 hover:bg-surface-container-high hover:text-on-surface'
      }`}
    >
      <span className="inline-flex items-center gap-1.5 text-body-md font-semibold">
        {title}
        {blocked && <span className="h-2 w-2 rounded-full bg-red-500" title="Blocked" aria-label="Blocked" />}
      </span>
      <span className="text-xs leading-tight text-on-surface/70">{sub}</span>
    </button>
  );
}

/** A unit's own tab: its switch, booking lengths and photos, then its prices, closed days and walk-in booking. */
function UnitPanel({
  unit,
  venueId,
  categories,
  minAdvance,
  sameFacility,
  onAsk,
  onChanged,
}: {
  unit: Resource;
  venueId: string;
  categories: VenueCategory[];
  minAdvance: Record<string, number>;
  /** Every unit of the same facility at this venue (for the block-the-whole-facility button). */
  sameFacility: Resource[];
  onAsk: (next: Pending) => void;
  onChanged: () => void;
}) {
  const facility = unit.category;
  const allBlocked = sameFacility.every((u) => !u.isBookable);
  return (
    <div className="space-y-6">
      <section aria-label={unit.name} className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-lowest text-on-surface ring-1 ring-outline-variant/50">
              <FacilityIcon iconKey={facility.iconKey} iconSvg={facility.iconSvg} className="text-[24px]" />
            </span>
            <div>
            <h2 className="text-body-md font-semibold text-on-surface">{facility.name}</h2>
            <p className="text-sm text-on-surface-variant">
              {sameFacility.length} {plural(facility.unitLabel.toLowerCase(), sameFacility.length)} ·{' '}
              <span className={sameFacility.every((u) => !u.isBookable) ? 'font-semibold text-red-700' : 'font-medium text-emerald-800'}>
                {sameFacility.every((u) => u.isBookable) ? 'all open' : `${sameFacility.filter((u) => u.isBookable).length} open`}
              </span>
            </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAsk({ kind: 'facility', facility, units: sameFacility, open: allBlocked })}
            className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${
              allBlocked
                ? 'border-emerald-600/50 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 focus-visible:ring-emerald-500/40'
                : 'border-red-600/40 bg-red-50 text-red-900 hover:bg-red-100 focus-visible:ring-red-500/40'
            }`}
          >
            <SvgIcon name={allBlocked ? 'unblock' : 'block'} className="h-4 w-4" />
            {allBlocked ? `Reopen ${facility.name}` : `Block ${facility.name}`}
          </button>
        </header>
        <div className="px-container-padding py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                  unit.isBookable ? 'bg-primary-fixed-dim/25 text-on-primary-container' : 'bg-red-50 text-red-700'
                }`}
              >
                {unit.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-body-md font-medium text-on-surface">{unit.name}</p>
                <p className="text-xs text-on-surface-variant">{unit.groundType ? `${facility.unitLabel} type · ${unit.groundType}` : facility.unitLabel}</p>
              </div>
            </div>
            <BookToggle on={unit.isBookable} label={`${unit.isBookable ? 'Block' : 'Reopen'} ${unit.name}`} onToggle={() => onAsk({ kind: 'unit', unit, open: !unit.isBookable })} />
          </div>
          <div className="space-y-3 pl-12">
            <UnitDurations unitId={unit.id} min={unit.minDurationMinutes} max={unit.maxDurationMinutes} hasPrices onSaved={onChanged} limits={limitsOf(categories.find((c) => c.id === facility.id))} />
            <UnitDescription path={`/resources/${unit.id}/description`} unitName={unit.name} description={unit.description ?? null} onSaved={onChanged} />
            <UnitPhotos unitId={unit.id} unitName={unit.name} initial={unit.photos ?? []} onChanged={onChanged} />
          </div>
        </div>
      </section>

      <UnitTools key={unit.id} venueId={venueId} unit={unit} categories={categories} minAdvance={minAdvance} />
    </div>
  );
}

/** Wording for the confirmation dialog of each kind of change. */
function describe(
  p: Pending,
  venue: Venue,
): { title: string; body: React.ReactNode; confirm: string; tone: 'primary' | 'warn' | 'danger' } {
  if (p.kind === 'status' && p.status === 'ACTIVE') {
    return {
      title: `Make ${venue.name} live?`,
      tone: 'primary',
      confirm: 'Make venue live',
      body: <p>Customers will be able to find and book this venue again.</p>,
    };
  }
  if (p.kind === 'status') {
    return {
      title: `Pause ${venue.name}?`,
      tone: 'warn',
      confirm: 'Pause venue',
      body: (
        <>
          <p>Customers will no longer be able to find or book this venue.</p>
          <p>Bookings that are already made are not affected. You can make it live again at any time.</p>
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
      <span className={`text-sm font-semibold ${on ? 'text-emerald-800' : 'text-red-800'}`}>
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
            // An owner can switch between Active and Inactive, but not a venue the platform has in Draft or Suspended.
            const canPick = !isCurrent && allowed.includes(status) && allowed.includes(current);
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
                      : 'Only the platform can change this venue’s status right now'
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
