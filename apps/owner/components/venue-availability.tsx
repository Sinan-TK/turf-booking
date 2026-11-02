'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Modal } from '@/components/modal';
import { SvgIcon } from '@/components/svg-icons';
import { durationLabel, type VenueCategory } from '@/lib/categories';
import {
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
import { Pagination, usePageSlice } from '@/components/list-kit';
import { hasErrors, numberError, type FieldErrors } from '@/lib/validation';

interface Resource {
  id: string;
  name: string;
  groundType: string;
  category: { id: string; name: string };
  /** The unit's shortest booking: its prices are per block of this length. */
  minDurationMinutes: number;
  maxDurationMinutes: number;
}

interface PricingRule {
  id: string;
  /** False = blocked: kept in the list but not used to price any slot. */
  isActive: boolean;
  durationMinutes: number;
  /** ISO weekdays this price applies to: 1 = Monday .. 7 = Sunday. */
  weekdays: number[];
  /** Only set on a rule written before weekdays existed. */
  dayType: string | null;
  startWindow: string | null;
  endWindow: string | null;
  /** Normal price: the full price when there is no offer. */
  normalPrice: string;
  /** Optional offer below the normal price; when set it is the full price. */
  offerPrice: string | null;
  /** The advance paid online to hold the slot; the rest is paid at the venue. */
  bookingPrice: string;
  /** The full price (the offer when there is one), computed by the API. */
  price: number;
  currency: string;
}
interface BlockedDate {
  id: string;
  resourceId: string | null;
  startTime: string;
  endTime: string;
  reason: string | null;
}

// Monday-first, ISO numbers (1 = Monday .. 7 = Sunday), the order owners expect.
const DAYS = [
  { n: 1, short: 'Mon', long: 'Monday' },
  { n: 2, short: 'Tue', long: 'Tuesday' },
  { n: 3, short: 'Wed', long: 'Wednesday' },
  { n: 4, short: 'Thu', long: 'Thursday' },
  { n: 5, short: 'Fri', long: 'Friday' },
  { n: 6, short: 'Sat', long: 'Saturday' },
  { n: 7, short: 'Sun', long: 'Sunday' },
];
type PriceField = 'days' | 'time' | 'normal' | 'offer' | 'booking';

const DAY_PRESETS = [
  { label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [6, 7] },
  { label: 'Fri–Sun', days: [5, 6, 7] },
];

/** "Mon–Fri", "Sat, Sun", "Every day" — runs of 3+ consecutive days become a range. */
/** The smallest advance for a full price, rounded up to the paisa (the API checks the same rule). */
function minAdvanceOf(fullPrice: number, percent: number): number {
  return Math.ceil(Math.round(fullPrice * 100) * percent / 100) / 100;
}

function daysLabel(rule: Pick<PricingRule, 'weekdays' | 'dayType'>): string {
  const days = rule.weekdays.length
    ? rule.weekdays
    : rule.dayType === 'WEEKDAY'
      ? [1, 2, 3, 4, 5]
      : rule.dayType === 'WEEKEND'
        ? [6, 7]
        : [];
  if (days.length === 0) return 'No days';
  if (days.length === 7) return 'Every day';
  const sorted = [...days].sort((x, y) => x - y);
  const name = (n: number) => DAYS[n - 1]!.short;
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${name(sorted[i]!)}–${name(sorted[j]!)}`);
    else for (let k = i; k <= j; k++) parts.push(name(sorted[k]!));
    i = j + 1;
  }
  return parts.join(', ');
}

/** "18:00" -> "6:00 pm"; "24:00" -> "midnight". */
function clock(hhmm: string): string {
  if (hhmm === '24:00') return 'midnight';
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The days a rule covers (a rule written before weekdays existed falls back to its old day type). */
function ruleDays(rule: Pick<PricingRule, 'weekdays' | 'dayType'>): number[] {
  if (rule.weekdays.length) return rule.weekdays;
  return rule.dayType === 'WEEKDAY' ? [1, 2, 3, 4, 5] : rule.dayType === 'WEEKEND' ? [6, 7] : [];
}

/**
 * Add or edit one price, in a modal. The API refuses a price that would overlap another
 * active one, and its message (it names the clash) is shown right in the form.
 */
function PriceModal({
  rule,
  resourceId,
  blockMinutes,
  minAdvancePercent,
  onClose,
  onSaved,
}: {
  /** Present = editing that price; absent = adding a new one. */
  rule?: PricingRule;
  resourceId: string;
  /** The unit's shortest booking; the price is for one block of this length. */
  blockMinutes: number;
  /** The least the customer must pay online, as a percentage of the full price (set by the platform for this facility). */
  minAdvancePercent?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    days: rule ? ruleDays(rule) : [1, 2, 3, 4, 5, 6, 7],
    allDay: !(rule?.startWindow && rule?.endWindow),
    from: rule?.startWindow ?? '18:00',
    // A time input can't show 24:00, so "end of day" is edited as 23:59 and sent back as 24:00.
    to: rule?.endWindow === '24:00' ? '23:59' : (rule?.endWindow ?? '23:00'),
    normal: rule ? String(Number(rule.normalPrice)) : '',
    offer: rule?.offerPrice != null ? String(Number(rule.offerPrice)) : '',
    booking: rule ? String(Number(rule.bookingPrice)) : '',
  });
  // The booking amount follows the full price until the owner types their own (a new price starts as pay-in-full).
  const [bookingTouched, setBookingTouched] = useState(!!rule);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<PriceField>>({});
  const clearError = (k: PriceField) => setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  const full = form.offer.trim() !== '' && Number(form.offer) < Number(form.normal) ? Number(form.offer) : Number(form.normal);
  const setPrice = (k: 'normal' | 'offer' | 'booking', value: string) => {
    clearError(k);
    if (k === 'booking') setBookingTouched(true);
    else clearError('booking');
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (!bookingTouched && k !== 'booking') {
        const offer = next.offer.trim() !== '' && Number(next.offer) < Number(next.normal) ? next.offer : '';
        next.booking = offer || next.normal;
      }
      return next;
    });
  };
  const [saving, setSaving] = useState(false);
  const sorted = (days: number[]) => [...days].sort((x, y) => x - y);
  const sameDays = (x: number[], y: number[]) =>
    x.length === y.length && sorted(x).every((d, i) => d === sorted(y)[i]);
  const toggleDay = (n: number) => {
    clearError('days');
    setForm((f) => ({
      ...f,
      days: f.days.includes(n) ? f.days.filter((d) => d !== n) : sorted([...f.days, n]),
    }));
  };
  const pill = (on: boolean) =>
    `min-w-[3.25rem] rounded-lg px-3 py-2 text-body-md font-medium transition-colors ${
      on
        ? 'bg-primary text-on-primary shadow-sm'
        : 'bg-surface-container-lowest text-on-surface ring-1 ring-inset ring-outline-variant/50 hover:bg-surface-container'
    }`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const offerGiven = form.offer.trim() !== '';
    const fullPrice = offerGiven && Number(form.offer) < Number(form.normal) ? Number(form.offer) : Number(form.normal);
    const found: FieldErrors<PriceField> = {
      days: form.days.length === 0 ? 'Choose at least one day.' : undefined,
      time: form.allDay
        ? undefined
        : !form.from || !form.to
          ? 'Enter both the start and end time.'
          : form.from >= form.to
            ? 'The end time must be after the start time.'
            : undefined,
      normal: numberError(form.normal, 'Normal price', 0, 1_000_000),
      offer: !offerGiven
        ? undefined
        : (numberError(form.offer, 'Offer price', 0, 1_000_000) ??
          (Number(form.offer) >= Number(form.normal) ? 'The offer price must be below the normal price.' : undefined)),
      booking:
        numberError(form.booking, 'Booking amount', 0, 1_000_000) ??
        (Number(form.booking) <= 0 && fullPrice > 0
          ? 'The booking amount must be more than 0.'
          : Number(form.booking) > fullPrice
            ? `The booking amount can\u2019t be more than the ${offerGiven ? 'offer' : 'normal'} price (${fullPrice}).`
            : minAdvancePercent !== undefined && Number(form.booking) < minAdvanceOf(fullPrice, minAdvancePercent)
              ? `The booking amount must be at least ${minAdvancePercent}% of the ${offerGiven ? 'offer' : 'normal'} price (${minAdvanceOf(fullPrice, minAdvancePercent)}).`
              : undefined),
    };
    setErrors(found);
    if (hasErrors(found)) return;
    const to = form.to === '23:59' ? '24:00' : form.to;
    const payload = {
      days: form.days,
      normalPrice: Number(form.normal),
      offerPrice: form.offer.trim() === '' ? null : Number(form.offer),
      bookingPrice: Number(form.booking),
    };
    setSaving(true);
    try {
      if (rule) {
        await api.patch(`/resources/pricing-rules/${rule.id}`, {
          ...payload,
          startWindow: form.allDay ? null : form.from,
          endWindow: form.allDay ? null : to,
        });
      } else {
        await api.post('/resources/pricing-rules', {
          ...payload,
          resourceId,
          currency: 'INR',
          ...(form.allDay ? {} : { startWindow: form.from, endWindow: to }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this price');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={rule ? 'Edit price' : 'Add a price'}
      subtitle={
        rule
          ? 'Change the days, hours, duration or amount.'
          : 'What a slot costs, on which days and at what times.'
      }
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="space-y-5 p-6">
          {error && <ErrorBanner message={error} />}

          <div>
            <Label>Days</Label>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Days this price applies to"
            >
              {DAYS.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  aria-pressed={form.days.includes(d.n)}
                  aria-label={d.long}
                  onClick={() => toggleDay(d.n)}
                  className={pill(form.days.includes(d.n))}
                >
                  {d.short}
                </button>
              ))}
            </div>
            <FieldError id="price-days-error" message={errors.days} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {DAY_PRESETS.map((pr) => (
                <button
                  key={pr.label}
                  type="button"
                  onClick={() => {
                    clearError('days');
                    setForm((f) => ({ ...f, days: pr.days }));
                  }}
                  className={`font-medium hover:underline ${sameDays(form.days, pr.days) ? 'text-on-surface' : 'text-primary'}`}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Time of day</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="inline-flex rounded-lg bg-surface-container p-1"
                role="radiogroup"
                aria-label="Time of day"
              >
                {[
                  { label: 'All day', value: true },
                  { label: 'Specific hours', value: false },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={form.allDay === o.value}
                    onClick={() => setForm((f) => ({ ...f, allDay: o.value }))}
                    className={`rounded-md px-3 py-1.5 text-body-md font-medium transition-colors ${
                      form.allDay === o.value
                        ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {!form.allDay && (
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    aria-label="From"
                    aria-invalid={!!errors.time}
                    value={form.from}
                    onChange={(e) => {
                      clearError('time');
                      setForm((f) => ({ ...f, from: e.target.value }));
                    }}
                    className={`!w-36 ${errors.time ? invalidClass : ''}`}
                  />
                  <span className="text-on-surface-variant">to</span>
                  <Input
                    type="time"
                    aria-label="To"
                    aria-invalid={!!errors.time}
                    value={form.to}
                    onChange={(e) => {
                      clearError('time');
                      setForm((f) => ({ ...f, to: e.target.value }));
                    }}
                    className={`!w-36 ${errors.time ? invalidClass : ''}`}
                  />
                </div>
              )}
            </div>
            <FieldError id="price-time-error" message={errors.time} />
            {!form.allDay && (
              <p className="mt-1.5 text-xs text-on-surface-variant">
                Applies to slots that <em>start</em> between these times. Use 11:59 pm for the end
                of the day.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <p className="text-xs text-on-surface-variant sm:col-span-2">
              These prices are for {durationLabel(blockMinutes)}. A longer booking costs the price for each{' '}
              {durationLabel(blockMinutes)} it covers, at the time that part starts.
            </p>
            <div className="sm:col-span-2">
              <fieldset className="rounded-lg bg-surface-container-low p-4">
                <legend className="px-1 text-body-md font-semibold text-on-surface">Prices (INR)</legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor="price-normal">Normal price</Label>
                    <Input
                      id="price-normal"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-invalid={!!errors.normal}
                      className={errors.normal ? invalidClass : ''}
                      value={form.normal}
                      onChange={(e) => setPrice('normal', e.target.value)}
                    />
                    <FieldError id="price-normal-error" message={errors.normal} />
                    <p className="mt-1 text-xs text-on-surface-variant">The full price of a slot.</p>
                  </div>
                  <div>
                    <Label htmlFor="price-offer">Offer price (optional)</Label>
                    <Input
                      id="price-offer"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-invalid={!!errors.offer}
                      className={errors.offer ? invalidClass : ''}
                      value={form.offer}
                      onChange={(e) => setPrice('offer', e.target.value)}
                    />
                    <FieldError id="price-offer-error" message={errors.offer} />
                    <p className="mt-1 text-xs text-on-surface-variant">Below the normal price. Replaces it as the full price.</p>
                  </div>
                  <div>
                    <Label htmlFor="price-booking">Booking amount</Label>
                    <Input
                      id="price-booking"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-invalid={!!errors.booking}
                      className={errors.booking ? invalidClass : ''}
                      value={form.booking}
                      onChange={(e) => setPrice('booking', e.target.value)}
                    />
                    <FieldError id="price-booking-error" message={errors.booking} />
                    <p className="mt-1 text-xs text-on-surface-variant">
                      The advance paid online to hold the slot
                      {minAdvancePercent !== undefined && ` (at least ${minAdvancePercent}% of the full price${Number.isFinite(full) && full > 0 ? `, INR ${minAdvanceOf(full, minAdvancePercent).toLocaleString('en-IN')}` : ''})`}.
                    </p>
                  </div>
                </div>
                {form.normal.trim() !== '' && form.booking.trim() !== '' && Number.isFinite(full) && Number(form.booking) >= 0 && Number(form.booking) <= full && (
                  <p className="mt-3 text-body-md text-on-surface" aria-live="polite">
                    Customer pays <strong>INR {Number(form.booking).toLocaleString('en-IN')}</strong> online to hold the slot
                    {full - Number(form.booking) > 0 ? (
                      <>
                        {' '}
                        and <strong>INR {(full - Number(form.booking)).toLocaleString('en-IN')}</strong> at the venue.
                      </>
                    ) : (
                      ', nothing more to pay at the venue.'
                    )}
                  </p>
                )}
              </fieldset>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-outline-variant/20 bg-surface-container-low px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : rule ? 'Save changes' : 'Add price'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

const ICON_BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function PricingRulesSection({
  resources,
  categories,
  minAdvance,
}: {
  resources: Resource[];
  categories: VenueCategory[];
  /** Minimum online advance (% of the full price) by facility id, from the platform's terms for this venue. */
  minAdvance: Record<string, number>;
}) {
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const unit = resources.find((r) => r.id === resourceId);
  const blockMinutes = unit?.minDurationMinutes ?? 60;
  const { data: rules, refetch } = useFetch<PricingRule[]>(
    resourceId ? `/resources/pricing-rules?resourceId=${resourceId}` : null,
  );
  // The add/edit modal: { rule } = edit that price, {} = add a new one, null = closed.
  const [editing, setEditing] = useState<{ rule?: PricingRule } | null>(null);
  const [pending, setPending] = useState<{
    kind: 'block' | 'unblock' | 'remove';
    rule: PricingRule;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function ask(kind: 'block' | 'unblock' | 'remove', rule: PricingRule) {
    setActionError(null);
    setPending({ kind, rule });
  }

  async function confirmAction() {
    if (!pending) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (pending.kind === 'remove') {
        await api.delete(`/resources/pricing-rules/${pending.rule.id}`);
      } else {
        await api.patch(`/resources/pricing-rules/${pending.rule.id}`, {
          isActive: pending.kind === 'unblock',
        });
      }
      setPending(null);
      refetch();
    } catch (err) {
      // e.g. unblocking a price that would now overlap another one: the API names the clash.
      setActionError(
        err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.',
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-on-surface">Pricing</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-on-surface-variant">
            Prices also decide when a unit can be booked: a slot can only be booked where an active
            price covers its day and time. Each price is for one block of this unit’s shortest booking; a longer booking costs one price per block. Choose All day for around-the-clock, or
            specific hours (for example 9–12 and 4–10 as two prices) to set when it opens and
            closes. Two active prices for the same unit can&apos;t cover the same day
            and time. Block or remove one first.
          </p>
        </div>
        <Button onClick={() => setEditing({})} className="inline-flex items-center gap-2">
          <SvgIcon name="plus" className="h-4 w-4" />
          Add price
        </Button>
      </div>
      <div className={resources.length > 1 ? 'mb-5' : 'hidden'}>
        <Label>Unit</Label>
        <Select
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className="max-w-xs"
        >
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.category.name}
              {r.groundType ? ` (${r.groundType})` : ''}
            </option>
          ))}
        </Select>
      </div>

      {rules && rules.length > 0 && (
        <div className="overflow-x-auto rounded-xl ring-1 ring-outline-variant/30">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-2.5 font-medium">Days</th>
                <th className="px-4 py-2.5 font-medium">Time of day</th>
                <th className="px-4 py-2.5 font-medium">Per</th>
                <th className="px-4 py-2.5 font-medium">Price</th>
                <th className="px-4 py-2.5 font-medium">Pay online</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-outline-variant/20 ${r.isActive ? '' : 'bg-surface-container-low/60'}`}
                >
                  <td
                    className={`px-4 py-3 font-medium ${r.isActive ? '' : 'text-on-surface-variant line-through'}`}
                  >
                    {daysLabel(r)}
                  </td>
                  <td
                    className={`px-4 py-3 text-on-surface-variant ${r.isActive ? '' : 'line-through'}`}
                  >
                    {r.startWindow && r.endWindow
                      ? `${clock(r.startWindow)} – ${clock(r.endWindow)}`
                      : 'All day'}
                  </td>
                  <td className="px-4 py-3">{durationLabel(r.durationMinutes)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold">
                    {r.offerPrice != null && (
                      <span className="mr-2 text-xs font-normal text-on-surface-variant line-through">
                        {r.currency} {Number(r.normalPrice).toLocaleString('en-IN')}
                      </span>
                    )}
                    {r.currency} {Number(r.price).toLocaleString('en-IN')}
                    {r.offerPrice != null && (
                      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Offer</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {r.currency} {Number(r.bookingPrice).toLocaleString('en-IN')}
                    {Number(r.bookingPrice) < r.price && (
                      <span className="block text-xs text-on-surface-variant">
                        {r.currency} {(r.price - Number(r.bookingPrice)).toLocaleString('en-IN')} at the venue
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      {r.isActive ? 'Active' : 'Blocked'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button
                      type="button"
                      aria-label="Edit price"
                      title="Edit"
                      onClick={() => setEditing({ rule: r })}
                      className={`${ICON_BUTTON} text-on-surface-variant hover:bg-surface-container hover:text-on-surface`}
                    >
                      <SvgIcon name="edit" className="h-[18px] w-[18px]" />
                    </button>
                    <button
                      type="button"
                      aria-label={r.isActive ? 'Block price' : 'Unblock price'}
                      title={r.isActive ? 'Block' : 'Unblock'}
                      onClick={() => ask(r.isActive ? 'block' : 'unblock', r)}
                      className={`${ICON_BUTTON} ${
                        r.isActive
                          ? 'text-amber-700 hover:bg-amber-50'
                          : 'text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      <SvgIcon
                        name={r.isActive ? 'block' : 'unblock'}
                        className="h-[18px] w-[18px]"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove price"
                      title="Remove"
                      onClick={() => ask('remove', r)}
                      className={`${ICON_BUTTON} text-red-700 hover:bg-red-50`}
                    >
                      <SvgIcon name="trash" className="h-[18px] w-[18px]" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rules && rules.length === 0 && (
        <p className="rounded-xl border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
          No prices yet. Use <span className="font-medium text-on-surface">Add price</span> to set
          one. Slots with no matching price can&apos;t be booked.
        </p>
      )}

      {editing && (
        <PriceModal
          rule={editing.rule}
          resourceId={resourceId}
          blockMinutes={blockMinutes}
          minAdvancePercent={minAdvance[resources.find((r) => r.id === resourceId)?.category.id ?? '']}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refetch();
          }}
        />
      )}

      {pending && (
        <ConfirmDialog
          title={
            pending.kind === 'remove'
              ? 'Remove this price?'
              : pending.kind === 'block'
                ? 'Block this price?'
                : 'Turn this price back on?'
          }
          tone={
            pending.kind === 'remove' ? 'danger' : pending.kind === 'block' ? 'warn' : 'primary'
          }
          confirmLabel={
            pending.kind === 'remove'
              ? 'Remove price'
              : pending.kind === 'block'
                ? 'Block price'
                : 'Unblock price'
          }
          busy={actionBusy}
          error={actionError}
          onConfirm={confirmAction}
          onCancel={() => setPending(null)}
        >
          <p className="font-medium text-on-surface">
            {daysLabel(pending.rule)},{' '}
            {pending.rule.startWindow && pending.rule.endWindow
              ? `${clock(pending.rule.startWindow)} – ${clock(pending.rule.endWindow)}`
              : 'all day'}
            , {pending.rule.durationMinutes} min at {pending.rule.currency}{' '}
            {Number(pending.rule.price).toLocaleString('en-IN')}
          </p>
          {pending.kind === 'block' && (
            <p>
              It stays in the list but won&apos;t be used. Slots it covered can&apos;t be booked
              until another price covers them, or you unblock it.
            </p>
          )}
          {pending.kind === 'unblock' && (
            <p>
              It will price those slots again. If another active price already covers the same days
              and times, it can&apos;t be turned on.
            </p>
          )}
          {pending.kind === 'remove' && (
            <p>
              This deletes the price for good. Slots it covered can&apos;t be booked until another
              price covers them.
            </p>
          )}
        </ConfirmDialog>
      )}
    </Card>
  );
}

/** Whole-day bounds in a plain "YYYY-MM-DD" string — treated as the
 * venue's own local calendar day, matching how a human picks a date on a
 * calendar (rather than converting through the browser's own timezone,
 * which could shift midnight by several hours for a venue in a different
 * region). `new Date("YYYY-MM-DDT00:00:00")`/`T23:59:59.999` are parsed
 * as local time by the JS engine, then serialized to ISO/UTC on send —
 * good enough here since every venue in this deployment is Asia/Kolkata
 * and the browser's local time is expected to match. */
function dayBounds(dateStr: string): { startTime: string; endTime: string } {
  return {
    startTime: new Date(`${dateStr}T00:00:00`).toISOString(),
    endTime: new Date(`${dateStr}T23:59:59.999`).toISOString(),
  };
}

function BlockedDatesSection({ venueId, resources, onlyResourceId }: { venueId: string; resources: Resource[]; onlyResourceId?: string }) {
  const { data: blocked, refetch } = useFetch<BlockedDate[]>(
    `/venue-config/blocked-dates?venueId=${venueId}`,
  );
  // Closed days pile up over a year: ten at a time.
  // On a unit's tab only that unit's closed days and the whole venue's are listed.
  const shownBlocked = (blocked ?? []).filter((b) => !onlyResourceId || !b.resourceId || b.resourceId === onlyResourceId);
  const blockedPage = usePageSlice(shownBlocked, 10, '');
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [form, setForm] = useState({ resourceId: '', date: '', endDate: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'date' | 'endDate' | 'reason'>>({});
  const edit = (patch: Partial<typeof form>, clear: 'date' | 'endDate' | 'reason') => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((p) => ({ ...p, [clear]: undefined, ...(clear === 'date' ? { endDate: undefined } : {}) }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found: FieldErrors<'date' | 'endDate' | 'reason'> = {
      date: form.date ? undefined : mode === 'range' ? 'Choose the first day.' : 'Choose the day to close.',
      endDate:
        mode !== 'range'
          ? undefined
          : !form.endDate
            ? 'Choose the last day.'
            : form.date && form.endDate < form.date
              ? 'The last day can\u2019t be before the first day.'
              : undefined,
      reason: form.reason.length > 300 ? 'Keep the reason to 300 characters.' : undefined,
    };
    setErrors(found);
    if (hasErrors(found)) return;
    setSubmitting(true);
    try {
      const { startTime } = dayBounds(form.date);
      const { endTime } = dayBounds(mode === 'range' && form.endDate ? form.endDate : form.date);
      await api.post('/venue-config/blocked-dates', {
        venueId,
        resourceId: form.resourceId || undefined,
        startTime,
        endTime,
        reason: form.reason || undefined,
      });
      setForm({ resourceId: '', date: '', endDate: '', reason: '' });
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create blocked date');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    try {
      await api.delete(`/venue-config/blocked-dates/${id}`);
      refetch();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-on-surface">Closed Days</h2>
      <p className="mb-4 text-xs text-on-surface-variant">
        Block a single day or a range of days. Leave &quot;Resource&quot; unset to close the entire
        venue — customers can&apos;t book, and any attempt during this window is rejected.
      </p>

      {!blocked && <LoadingState />}
      {blocked && shownBlocked.length > 0 && (
        <div className="mb-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="py-2">Scope</th>
                <th className="py-2">Dates</th>
                <th className="py-2">Reason</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {blockedPage.rows.map((b) => {
                const start = new Date(b.startTime);
                const end = new Date(b.endTime);
                const sameDay = start.toDateString() === end.toDateString();
                return (
                  <tr key={b.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">
                      {b.resourceId
                        ? (resources.find((r) => r.id === b.resourceId)?.name ?? 'Resource')
                        : 'Whole venue'}
                    </td>
                    <td className="py-2 text-on-surface-variant">
                      {sameDay
                        ? start.toLocaleDateString()
                        : `${start.toLocaleDateString()} – ${end.toLocaleDateString()}`}
                    </td>
                    <td className="py-2 text-on-surface-variant">{b.reason || '—'}</td>
                    <td className="py-2 text-right">
                      <button
                        className="text-xs font-medium text-error hover:underline disabled:opacity-50"
                        disabled={deletingId === b.id}
                        onClick={() => onDelete(b.id)}
                      >
                        {deletingId === b.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={blockedPage.page} pageSize={10} total={blockedPage.total} onPage={blockedPage.setPage} />
        </div>
      )}
      {blocked && shownBlocked.length === 0 && (
        <p className="mb-6 text-sm text-on-surface-variant">No closed days.</p>
      )}

      <form onSubmit={onSubmit} noValidate className="space-y-3 border-t border-outline-variant/20 pt-4">
        {error && <ErrorBanner message={error} />}

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'single' ? 'primary' : 'secondary'}
            onClick={() => setMode('single')}
          >
            Single day
          </Button>
          <Button
            type="button"
            variant={mode === 'range' ? 'primary' : 'secondary'}
            onClick={() => setMode('range')}
          >
            Range of days
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="closed-date">{mode === 'range' ? 'From' : 'Date'}</Label>
            <Input
              id="closed-date"
              type="date"
              aria-invalid={!!errors.date}
              className={errors.date ? invalidClass : ''}
              value={form.date}
              onChange={(e) => edit({ date: e.target.value }, 'date')}
            />
            <FieldError id="closed-date-error" message={errors.date} />
          </div>
          {mode === 'range' && (
            <div>
              <Label htmlFor="closed-end-date">To</Label>
              <Input
                id="closed-end-date"
                type="date"
                min={form.date || undefined}
                aria-invalid={!!errors.endDate}
                className={errors.endDate ? invalidClass : ''}
                value={form.endDate}
                onChange={(e) => edit({ endDate: e.target.value }, 'endDate')}
              />
              <FieldError id="closed-end-date-error" message={errors.endDate} />
            </div>
          )}
          <div>
            <Label>Resource (optional)</Label>
            <Select
              value={form.resourceId}
              onChange={(e) => setForm((f) => ({ ...f, resourceId: e.target.value }))}
            >
              <option value="">Whole venue (all units)</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="closed-reason">Reason (optional)</Label>
            <Input
              id="closed-reason"
              aria-invalid={!!errors.reason}
              className={errors.reason ? invalidClass : ''}
              value={form.reason}
              onChange={(e) => edit({ reason: e.target.value }, 'reason')}
            />
            <FieldError id="closed-reason-error" message={errors.reason} />
          </div>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Closing…' : mode === 'range' ? 'Close These Days' : 'Close This Day'}
        </Button>
      </form>
    </Card>
  );
}

const TABS = [
  {
    key: 'pricing',
    label: 'Pricing & hours',
    hint: 'What each unit costs, and when it can be booked',
  },
  { key: 'closed', label: 'Closed days', hint: 'Holidays and maintenance' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

/**
 * Everything a unit needs beyond its settings, as two small tabs inside the unit's own tab on the venue page: its prices (which
 * also set when it can be booked) and the days it is closed (or the whole venue). Walk-in bookings have their own page.
 */
export function UnitTools({
  venueId,
  unit,
  categories,
  minAdvance,
}: {
  venueId: string;
  unit: Resource;
  categories: VenueCategory[];
  /** Minimum online advance (% of the full price) by facility id, from the platform's terms for this venue. */
  minAdvance: Record<string, number>;
}) {
  const [tab, setTab] = useState<TabKey>('pricing');
  const current = TABS.find((t) => t.key === tab)!;
  const resources = [unit];
  return (
    <div className="space-y-4">
      <div>
        <div role="tablist" aria-label={`${unit.name} settings`} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-container p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${unit.id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${unit.id}-tab-panel`}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap rounded-lg px-4 py-2 text-body-md font-medium transition-colors ${
                tab === t.key ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">{current.hint}</p>
      </div>
      <div id={`${unit.id}-tab-panel`} role="tabpanel" aria-labelledby={`${unit.id}-tab-${tab}`}>
        {tab === 'pricing' && <PricingRulesSection resources={resources} categories={categories} minAdvance={minAdvance} />}
        {tab === 'closed' && <BlockedDatesSection venueId={venueId} resources={resources} onlyResourceId={unit.id} />}
      </div>
    </div>
  );
}
