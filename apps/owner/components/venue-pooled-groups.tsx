'use client';

import { useEffect, useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { optimistic, type Mutate } from '@/lib/optimistic';
import { durationLabel, type VenueCategory, type VenueCategorySummary } from '@/lib/categories';
import { Button, ErrorBanner, FieldError, Input, Label, Select, invalidClass } from '@/components/ui';
import { UnitPhotos, type UnitPhoto } from '@/components/unit-photos';
import { UnitDescription } from '@/components/unit-description';

/** A fixed slot as the API keeps it: venue-local times, how many items, and the price and online amount for one item (null = not priced yet). */
interface ApiSlot {
  start: string;
  end: string;
  count: number;
  price: number | null;
  advance: number | null;
}

/** A slot while it is being typed: every box is text. */
interface SlotDraft {
  start: string;
  end: string;
  count: string;
  price: string;
  advance: string;
}

const draftsOf = (slots: ApiSlot[]): SlotDraft[] =>
  slots.map((s) => ({ start: s.start, end: s.end === '24:00' ? '23:59' : s.end, count: String(s.count), price: s.price === null ? '' : String(s.price), advance: s.advance === null ? '' : String(s.advance) }));

/** What the API takes: the online amount defaults to the whole price, and a slot with no price is sent unpriced. */
const toApi = (drafts: SlotDraft[]): ApiSlot[] =>
  drafts.map((d) => {
    const price = d.price.trim() === '' ? null : Number(d.price);
    return {
      start: d.start,
      end: d.end === '23:59' ? '24:00' : d.end,
      count: Number(d.count),
      price,
      advance: price === null ? null : d.advance.trim() === '' ? price : Number(d.advance),
    };
  });

/** The first thing missing in a list of slots, in words, or null. (The API checks the rest: overlaps, the fleet size, the booking grid.) */
function draftsProblem(drafts: SlotDraft[]): string | null {
  if (drafts.length === 0) return 'Add at least one slot.';
  for (const d of drafts) {
    if (!d.start || !d.end) return 'Enter the start and end of every slot.';
    if (d.start >= d.end) return 'Each slot must end after it starts.';
    if (!(Number(d.count) >= 1)) return 'Enter how many are available in every slot.';
    if (d.price.trim() !== '' && !(Number(d.price) >= 0)) return 'Enter a price like 400.';
  }
  return null;
}

export interface Group {
  id: string;
  name: string;
  allocationMode: 'EXCLUSIVE' | 'POOLED';
  totalUnits: number | null;
  isBookable: boolean;
  slotMode: 'FLEXIBLE' | 'FIXED';
  fixedSlots: ApiSlot[];
  category: VenueCategorySummary;
  /** Up to three, main photo first: what customers see on the card. */
  photos: UnitPhoto[];
  description?: string | null;
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

/**
 * The slots of a fixed-times item: one row each with when it runs (from, to), how many are available in it and what one costs (and how
 * much one pays online). A slot with no price is kept but customers do not see it yet.
 */
function SlotsEditor({ slots, onChange, idPrefix, thing }: { slots: SlotDraft[]; onChange: (slots: SlotDraft[]) => void; idPrefix: string; thing: string }) {
  const set = (i: number, patch: Partial<SlotDraft>) => onChange(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  function add() {
    const last = slots[slots.length - 1];
    onChange([...slots, { start: last?.end && last.end < '23:00' ? last.end : '08:00', end: '', count: last?.count ?? '', price: last?.price ?? '', advance: last?.advance ?? '' }]);
  }
  return (
    <div className="space-y-3">
      {slots.length === 0 && <p className="text-xs text-on-surface-variant">No slots yet. Add the first one.</p>}
      {slots.map((s, i) => {
        const minutes = s.start && s.end && s.end > s.start ? (Number(s.end.slice(0, 2)) * 60 + Number(s.end.slice(3))) - (Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3))) : 0;
        return (
          <div key={i} role="group" aria-label={`Slot ${i + 1}`} className="rounded-lg bg-surface-container-low p-3 ring-1 ring-outline-variant/30">
            <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
              <div>
                <Label htmlFor={`${idPrefix}-${i}-start`}>From</Label>
                <Input id={`${idPrefix}-${i}-start`} type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-${i}-end`}>To</Label>
                <Input id={`${idPrefix}-${i}-end`} type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-${i}-count`}>How many {thing}s</Label>
                <Input id={`${idPrefix}-${i}-count`} type="number" min={1} value={s.count} onChange={(e) => set(i, { count: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-${i}-price`}>Price for one</Label>
                <Input id={`${idPrefix}-${i}-price`} inputMode="decimal" placeholder="INR" value={s.price} onChange={(e) => set(i, { price: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${idPrefix}-${i}-advance`}>Pay online (one)</Label>
                <Input id={`${idPrefix}-${i}-advance`} inputMode="decimal" placeholder="same as price" value={s.advance} onChange={(e) => set(i, { advance: e.target.value })} />
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="secondary" aria-label={`Remove slot ${i + 1}`} onClick={() => onChange(slots.filter((_, k) => k !== i))}>
                  Remove
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-on-surface-variant">
              {minutes > 0 ? durationLabel(minutes) : 'Set the start and the end.'}
              {s.price.trim() === '' && ' · no price yet, so customers will not see this slot'}
            </p>
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={add}>
        Add slot
      </Button>
    </div>
  );
}

/** One pooled item (a kayak fleet): its count, whether it is open, its slot times and its prices per kayak. */
export function GroupCard({ group, category, onChanged }: { group: Group; category?: VenueCategory; onChanged: () => void }) {
  const [count, setCount] = useState(String(group.totalUnits ?? 1));
  const [mode, setMode] = useState(group.slotMode);
  const [slots, setSlots] = useState<SlotDraft[]>(() => draftsOf(group.fixedSlots ?? []));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: prices, refetch: refetchPrices, mutate: mutatePrices } = useFetch<GroupPrice[]>(`/resources/pricing-rules?resourceGroupId=${group.id}`);
  // The switch flips at once and goes back (with a message) if the server refuses.
  const [bookable, setBookable] = useState(group.isBookable);
  useEffect(() => setBookable(group.isBookable), [group.isBookable]);

  async function toggleBookable() {
    const next = !bookable;
    setBookable(next);
    setError(null);
    setSaved(null);
    try {
      await api.patch(`/resources/groups/${group.id}`, { isBookable: next });
      setSaved(next ? 'Open for booking' : 'Blocked');
      onChanged();
    } catch (err) {
      setBookable(!next);
      setError(err instanceof ApiError ? err.message : 'Could not save this');
    }
  }

  const countChanged = Number(count) !== group.totalUnits;
  const slotsChanged = mode !== group.slotMode || (mode === 'FIXED' && JSON.stringify(toApi(slots)) !== JSON.stringify(group.fixedSlots ?? []));
  const slotsProblem = mode === 'FIXED' ? draftsProblem(slots) : null;

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
            {group.totalUnits === 1 ? '' : 's'} · {group.slotMode === 'FIXED' ? 'fixed slots' : 'any start time'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={bookable}
          aria-label={`${bookable ? 'Block' : 'Reopen'} ${group.name}`}
          onClick={() => void toggleBookable()}
          className="inline-flex shrink-0 items-center gap-2.5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className={`text-xs font-medium ${bookable ? 'text-emerald-700' : 'text-red-700'}`}>{bookable ? 'Open' : 'Blocked'}</span>
          <span className={`relative h-6 w-11 rounded-full transition-colors ${bookable ? 'bg-emerald-500' : 'bg-red-400'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${bookable ? 'left-[22px]' : 'left-0.5'}`} />
          </span>
        </button>
      </header>

      <div className="space-y-6 p-container-padding">
        {error && <ErrorBanner message={error} />}
        {saved && <p role="status" className="text-sm font-medium text-emerald-700">{saved} saved.</p>}

        <UnitDescription path={`/resources/groups/${group.id}`} unitName={group.name} description={group.description ?? null} onSaved={onChanged} />

        <div>
          <p className="font-label-md text-label-md text-on-surface-variant">Photos</p>
          <UnitPhotos unitId={group.id} unitName={group.name} initial={group.photos ?? []} basePath={`/resources/groups/${group.id}`} onChanged={onChanged} />
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
              Fixed slots only
            </label>
          </div>
          {mode === 'FIXED' && (
            <div className="mt-3">
              <SlotsEditor slots={slots} onChange={setSlots} idPrefix={`slots-${group.id}`} thing={group.category.unitLabel.toLowerCase()} />
              {slotsProblem && slotsChanged && <p role="alert" className="mt-2 text-xs text-red-700">{slotsProblem}</p>}
            </div>
          )}
          <div className="mt-3">
            <Button
              type="button"
              disabled={busy || !slotsChanged || !!slotsProblem}
              onClick={() => void patch({ slotMode: mode, ...(mode === 'FIXED' ? { fixedSlots: toApi(slots) } : {}) }, 'Slots')}
            >
              Save slots
            </Button>
          </div>
        </fieldset>

        {mode === 'FLEXIBLE' ? (
          <PricesSection group={group} category={category} prices={prices ?? []} refetch={refetchPrices} mutate={mutatePrices} />
        ) : (
          <p className="text-xs text-on-surface-variant">With fixed slots, each slot has its own price above. Prices by length and hours are used only when the start can be any time.</p>
        )}
      </div>
    </section>
  );
}

/** What one kayak costs for a length and the hours/days it can be booked; the open hours of the group come from these. */
function PricesSection({ group, category, prices, refetch, mutate }: { group: Group; category?: VenueCategory; prices: GroupPrice[]; refetch: () => void; mutate: Mutate<GroupPrice[]> }) {
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

  /** The price leaves the list at once; it comes back with a message if the server could not remove it. */
  async function remove(id: string) {
    setError(null);
    await optimistic(mutate, (all) => all.filter((p) => p.id !== id), () => api.delete(`/resources/pricing-rules/${id}`), setError);
    refetch();
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
  const [form, setForm] = useState({ categoryId: '', name: '', count: '', mode: 'FLEXIBLE' as 'FLEXIBLE' | 'FIXED', slots: [] as SlotDraft[] });
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
      times: form.mode === 'FIXED' ? (draftsProblem(form.slots) ?? undefined) : undefined,
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
        ...(form.mode === 'FIXED' ? { fixedSlots: toApi(form.slots) } : {}),
      });
      setForm((f) => ({ ...f, name: '', count: '', slots: [] }));
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
                  Fixed slots only
                </label>
              </div>
              {form.mode === 'FIXED' && (
                <div className="mt-3">
                  <SlotsEditor slots={form.slots} onChange={(slots) => setForm((f) => ({ ...f, slots }))} idPrefix="pool-new" thing={itemWord} />
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
