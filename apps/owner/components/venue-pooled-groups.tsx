'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { durationLabel, type VenueCategory, type VenueCategorySummary } from '@/lib/categories';
import { Button, ErrorBanner, FieldError, Input, Label, Select, invalidClass } from '@/components/ui';
import { UnitPhotos, type UnitPhoto } from '@/components/unit-photos';

export interface Group {
  id: string;
  name: string;
  allocationMode: 'EXCLUSIVE' | 'POOLED';
  totalUnits: number | null;
  isBookable: boolean;
  slotMode: 'FLEXIBLE' | 'FIXED';
  fixedStartTimes: string[];
  category: VenueCategorySummary;
  /** Up to three, main photo first: what customers see on the card. */
  photos: UnitPhoto[];
}

interface GroupPrice {
  id: string;
  isActive: boolean;
  durationMinutes: number | null;
  weekdays: number[];
  startWindow: string | null;
  endWindow: string | null;
  normalPrice: string;
  offerPrice: string | null;
  bookingPrice: string;
}

const DAY_CHOICES = [
  { label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [6, 7] },
];

function daysText(days: number[]): string {
  const hit = DAY_CHOICES.find((c) => c.days.length === days.length && c.days.every((d) => days.includes(d)));
  return hit ? hit.label : days.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(', ');
}

/** "18:30" -> "6:30 pm". */
function clock(hhmm: string): string {
  if (hhmm === '24:00') return 'midnight';
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The departure times as removable chips, with a time box to add another. */
function TimesEditor({ times, onChange, idPrefix }: { times: string[]; onChange: (times: string[]) => void; idPrefix: string }) {
  const [draft, setDraft] = useState('');
  function add() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft) || times.includes(draft)) return;
    onChange([...times, draft].sort());
    setDraft('');
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {times.length === 0 && <span className="text-xs text-on-surface-variant">No departure times yet.</span>}
        {times.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary-fixed-dim/25 px-3 py-1 text-sm font-medium text-on-primary-container">
            {clock(t)}
            <button type="button" aria-label={`Remove ${clock(t)}`} onClick={() => onChange(times.filter((x) => x !== t))} className="rounded-full px-1 text-base leading-none hover:bg-black/10">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div>
          <Label htmlFor={`${idPrefix}-time`}>Departure time</Label>
          <Input id={`${idPrefix}-time`} type="time" step={60} value={draft} onChange={(e) => setDraft(e.target.value)} className="w-40" />
        </div>
        <Button type="button" variant="secondary" onClick={add} disabled={!draft}>
          Add time
        </Button>
      </div>
    </div>
  );
}

/** One pooled item (a kayak fleet): its count, whether it is open, its slot times and its prices per kayak. */
export function GroupCard({ group, category, onChanged }: { group: Group; category?: VenueCategory; onChanged: () => void }) {
  const [count, setCount] = useState(String(group.totalUnits ?? 1));
  const [mode, setMode] = useState(group.slotMode);
  const [times, setTimes] = useState(group.fixedStartTimes);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: prices, refetch: refetchPrices } = useFetch<GroupPrice[]>(`/resources/pricing-rules?resourceGroupId=${group.id}`);

  const countChanged = Number(count) !== group.totalUnits;
  const slotsChanged = mode !== group.slotMode || (mode === 'FIXED' && times.join() !== group.fixedStartTimes.join());

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api.patch(`/resources/groups/${group.id}`, body);
      setSaved(done);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={group.name} className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
        <div>
          <h3 className="text-body-md font-semibold text-on-surface">{group.name}</h3>
          <p className="text-xs text-on-surface-variant">
            {group.category.name} · {group.totalUnits} {group.category.unitLabel.toLowerCase()}
            {group.totalUnits === 1 ? '' : 's'} · {group.slotMode === 'FIXED' ? 'fixed times' : 'any start time'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={group.isBookable}
          aria-label={`${group.isBookable ? 'Block' : 'Reopen'} ${group.name}`}
          disabled={busy}
          onClick={() => void patch({ isBookable: !group.isBookable }, group.isBookable ? 'Blocked' : 'Open for booking')}
          className="inline-flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className={`text-xs font-medium ${group.isBookable ? 'text-emerald-700' : 'text-red-700'}`}>{group.isBookable ? 'Open' : 'Blocked'}</span>
          <span className={`relative h-6 w-11 rounded-full transition-colors ${group.isBookable ? 'bg-emerald-500' : 'bg-red-400'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${group.isBookable ? 'left-[22px]' : 'left-0.5'}`} />
          </span>
        </button>
      </header>

      <div className="space-y-6 p-container-padding">
        {error && <ErrorBanner message={error} />}
        {saved && <p role="status" className="text-sm font-medium text-emerald-700">{saved} saved.</p>}

        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Photos</p>
          <UnitPhotos unitId={group.id} unitName={group.name} initial={group.photos ?? []} basePath={`/resources/groups/${group.id}`} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor={`count-${group.id}`}>How many {group.category.unitLabel.toLowerCase()}s</Label>
            <Input id={`count-${group.id}`} type="number" min={1} max={10000} value={count} onChange={(e) => setCount(e.target.value)} className="w-32" />
          </div>
          <Button type="button" disabled={busy || !countChanged || !(Number(count) >= 1)} onClick={() => void patch({ totalUnits: Number(count) }, 'Count')}>
            Save count
          </Button>
        </div>

        <fieldset>
          <legend className="mb-1 font-label-md text-label-md text-on-surface-variant">Start times</legend>
          <div className="flex flex-wrap gap-4 text-body-md">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={`mode-${group.id}`} checked={mode === 'FLEXIBLE'} onChange={() => setMode('FLEXIBLE')} />
              Any time inside the open hours
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name={`mode-${group.id}`} checked={mode === 'FIXED'} onChange={() => setMode('FIXED')} />
              Fixed times only
            </label>
          </div>
          {mode === 'FIXED' && (
            <div className="mt-3">
              <TimesEditor times={times} onChange={setTimes} idPrefix={`times-${group.id}`} />
            </div>
          )}
          <div className="mt-3">
            <Button
              type="button"
              disabled={busy || !slotsChanged || (mode === 'FIXED' && times.length === 0)}
              onClick={() => void patch({ slotMode: mode, ...(mode === 'FIXED' ? { fixedStartTimes: times } : {}) }, 'Start times')}
            >
              Save start times
            </Button>
          </div>
        </fieldset>

        <PricesSection group={group} category={category} prices={prices ?? []} refetch={refetchPrices} />
      </div>
    </section>
  );
}

/** What one kayak costs for a length and the hours/days it can be booked; the open hours of the group come from these. */
function PricesSection({ group, category, prices, refetch }: { group: Group; category?: VenueCategory; prices: GroupPrice[]; refetch: () => void }) {
  const lengths = category?.policy.durations?.length ? category.policy.durations : [60, 120, 180];
  const [form, setForm] = useState({ length: String(lengths[0] ?? 60), days: 0, from: '06:00', to: '18:00', price: '', advance: '' });
  const [errors, setErrors] = useState<{ price?: string; time?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found: { price?: string; time?: string } = {
      price: form.price.trim() === '' || !(Number(form.price) >= 0) ? 'Enter the price for one.' : undefined,
      time: !form.from || !form.to || form.from >= form.to ? 'The end time must be after the start time.' : undefined,
    };
    setErrors(found);
    if (found.price || found.time) return;
    setBusy(true);
    try {
      await api.post('/resources/pricing-rules', {
        resourceGroupId: group.id,
        durationMinutes: Number(form.length),
        days: DAY_CHOICES[form.days]!.days,
        pricingMode: 'PER_UNIT',
        normalPrice: Number(form.price),
        bookingPrice: form.advance.trim() === '' ? Number(form.price) : Number(form.advance),
        startWindow: form.from,
        endWindow: form.to,
        currency: 'INR',
      });
      setForm((f) => ({ ...f, price: '', advance: '' }));
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this price');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.delete(`/resources/pricing-rules/${id}`);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this price');
    }
  }

  const unit = group.category.unitLabel.toLowerCase();
  return (
    <div>
      <h4 className="text-sm font-semibold text-on-surface">Prices (for one {unit})</h4>
      <p className="mt-0.5 text-xs text-on-surface-variant">
        A customer pays the price times how many they book. The hours of these prices are the hours the {group.name.toLowerCase()} can be booked. Add one price for each length you offer.
      </p>
      {prices.length > 0 && (
        <ul className="mt-3 divide-y divide-outline-variant/20 rounded-lg ring-1 ring-outline-variant/30">
          {prices.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-body-md">
              <span>
                <strong>INR {Number(p.offerPrice ?? p.normalPrice).toLocaleString('en-IN')}</strong>
                {p.offerPrice != null && <s className="ml-1 text-xs text-on-surface-variant">INR {Number(p.normalPrice).toLocaleString('en-IN')}</s>} per {unit} · {p.durationMinutes ? durationLabel(p.durationMinutes) : ''} · {daysText(p.weekdays)}
                {p.startWindow && p.endWindow ? ` · ${clock(p.startWindow)} – ${clock(p.endWindow)}` : ' · all day'}
                <span className="text-xs text-on-surface-variant"> · pay online INR {Number(p.bookingPrice).toLocaleString('en-IN')}</span>
              </span>
              <Button type="button" variant="secondary" aria-label={`Remove price of INR ${Number(p.offerPrice ?? p.normalPrice)} for ${p.durationMinutes ?? ''} minutes`} onClick={() => void remove(p.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate className="mt-3 grid grid-cols-2 items-start gap-3 md:grid-cols-6">
        <div>
          <Label htmlFor={`len-${group.id}`}>Length</Label>
          <Select id={`len-${group.id}`} value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))}>
            {lengths.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`days-${group.id}`}>Days</Label>
          <Select id={`days-${group.id}`} value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: Number(e.target.value) }))}>
            {DAY_CHOICES.map((c, i) => (
              <option key={c.label} value={i}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`from-${group.id}`}>From</Label>
          <Input id={`from-${group.id}`} type="time" value={form.from} aria-invalid={!!errors.time} className={errors.time ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))} />
        </div>
        <div>
          <Label htmlFor={`to-${group.id}`}>To</Label>
          <Input id={`to-${group.id}`} type="time" value={form.to} aria-invalid={!!errors.time} className={errors.time ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
          <FieldError id={`time-${group.id}-error`} message={errors.time} />
        </div>
        <div>
          <Label htmlFor={`price-${group.id}`}>Price for one</Label>
          <Input id={`price-${group.id}`} inputMode="decimal" placeholder="INR" value={form.price} aria-invalid={!!errors.price} className={errors.price ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          <FieldError id={`price-${group.id}-error`} message={errors.price} />
        </div>
        <div>
          <Label htmlFor={`adv-${group.id}`}>Pay online (one)</Label>
          <Input id={`adv-${group.id}`} inputMode="decimal" placeholder="same as price" value={form.advance} onChange={(e) => setForm((f) => ({ ...f, advance: e.target.value }))} />
        </div>
        <div className="col-span-2 md:col-span-6">
          {error && <div className="mb-2"><ErrorBanner message={error} /></div>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add price'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The form that adds a pooled item (a fleet of identical things customers book by number, like 10 kayaks): its facility, name, how many
 * and when it starts. It sits on the venue page's New tab, and shows nothing when the platform has no pooled venue type.
 */
export function AddPooledItem({ venueId, categories, count, onAdded }: { venueId: string; categories: VenueCategory[] | null; count: number; onAdded: (id: string) => void }) {
  const pooledTypes = (categories ?? []).filter((c) => c.defaultAllocationMode === 'POOLED' && c.isActive);
  const [form, setForm] = useState({ categoryId: '', name: '', count: '', mode: 'FLEXIBLE' as 'FLEXIBLE' | 'FIXED', times: [] as string[] });
  const [errors, setErrors] = useState<{ categoryId?: string; name?: string; count?: string; times?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (pooledTypes.length === 0) return null;
  const chosen = pooledTypes.find((c) => c.id === form.categoryId);
  const itemWord = chosen ? chosen.unitLabel.toLowerCase() : 'item';

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found = {
      categoryId: form.categoryId ? undefined : 'Select a facility.',
      name: form.name.trim() ? undefined : 'Enter a name.',
      count: Number.isInteger(Number(form.count)) && Number(form.count) >= 1 ? undefined : `Enter how many ${itemWord}s you have.`,
      times: form.mode === 'FIXED' && form.times.length === 0 ? 'Add at least one departure time.' : undefined,
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>('/resources/groups', {
        venueId,
        categoryId: form.categoryId,
        name: form.name.trim(),
        allocationMode: 'POOLED',
        totalUnits: Number(form.count),
        sortOrder: count,
        slotMode: form.mode,
        ...(form.mode === 'FIXED' ? { fixedStartTimes: form.times } : {}),
      });
      setForm((f) => ({ ...f, name: '', count: '', times: [] }));
      setErrors({});
      onAdded(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {
        <section className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
          <header className="flex items-center gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-light leading-none text-on-primary">+</span>
            <div>
              <h2 className="text-body-md font-semibold text-on-surface">Add a pooled item</h2>
              <p className="text-xs text-on-surface-variant">A fleet of identical things customers book by number, like 10 kayaks.</p>
            </div>
          </header>
          <form onSubmit={add} noValidate className="space-y-5 p-container-padding">
            {error && <ErrorBanner message={error} />}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="pool-category">Facility</Label>
                <Select id="pool-category" value={form.categoryId} aria-invalid={!!errors.categoryId} className={errors.categoryId ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
                  <option value="">Select facility…</option>
                  {pooledTypes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <FieldError id="pool-category-error" message={errors.categoryId} />
              </div>
              <div>
                <Label htmlFor="pool-name">Name</Label>
                <Input id="pool-name" placeholder="e.g. Single kayaks" value={form.name} aria-invalid={!!errors.name} className={errors.name ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                <FieldError id="pool-name-error" message={errors.name} />
              </div>
              <div>
                <Label htmlFor="pool-count">How many {itemWord}s</Label>
                <Input id="pool-count" type="number" min={1} max={10000} value={form.count} aria-invalid={!!errors.count} className={errors.count ? invalidClass : ''} onChange={(e) => setForm((f) => ({ ...f, count: e.target.value }))} />
                <FieldError id="pool-count-error" message={errors.count} />
              </div>
            </div>
            <fieldset>
              <legend className="mb-1 font-label-md text-label-md text-on-surface-variant">Start times</legend>
              <div className="flex flex-wrap gap-4 text-body-md">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="pool-mode" checked={form.mode === 'FLEXIBLE'} onChange={() => setForm((f) => ({ ...f, mode: 'FLEXIBLE' }))} />
                  Any time inside the open hours
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="pool-mode" checked={form.mode === 'FIXED'} onChange={() => setForm((f) => ({ ...f, mode: 'FIXED' }))} />
                  Fixed times only
                </label>
              </div>
              {form.mode === 'FIXED' && (
                <div className="mt-3">
                  <TimesEditor times={form.times} onChange={(times) => setForm((f) => ({ ...f, times }))} idPrefix="pool-new" />
                  <FieldError id="pool-times-error" message={errors.times} />
                </div>
              )}
            </fieldset>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-on-surface-variant">After adding it, set what one costs inside its card.</p>
              <Button type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add pooled item'}
              </Button>
            </div>
          </form>
        </section>
      }
    </div>
  );
}
