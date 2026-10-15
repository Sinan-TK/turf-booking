'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { durationLabel, type VenueCategory, type VenueCategorySummary } from '@/lib/categories';
import {
  Button,
  Card,
  ErrorBanner,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
  SuccessBanner,
} from '@/components/ui';

interface Resource {
  id: string;
  name: string;
  groundType: string;
}
interface PricingRule {
  id: string;
  durationMinutes: number;
  dayType: string;
  price: string;
  currency: string;
}
interface OperatingHour {
  id: string;
  weekday: number;
  openTime: string;
  closeTime: string;
}
interface BlockedDate {
  id: string;
  resourceId: string | null;
  startTime: string;
  endTime: string;
  reason: string | null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function PricingRulesSection({ resources, durations }: { resources: Resource[]; durations: number[] }) {
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? '');
  const { data: rules, refetch } = useFetch<PricingRule[]>(
    resourceId ? `/resources/pricing-rules?resourceId=${resourceId}` : null,
  );
  const [form, setForm] = useState({ durationMinutes: String(durations[0] ?? 60), dayType: 'WEEKDAY', price: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/resources/pricing-rules', {
        resourceId,
        durationMinutes: Number(form.durationMinutes),
        dayType: form.dayType,
        price: Number(form.price),
        currency: 'INR',
      });
      setForm({ durationMinutes: String(durations[0] ?? 60), dayType: 'WEEKDAY', price: '' });
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create pricing rule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-on-surface">Pricing Rules</h2>
      <div className="mb-4">
        <Label>Resource</Label>
        <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="max-w-xs">
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.groundType})
            </option>
          ))}
        </Select>
      </div>

      {rules && rules.length > 0 && (
        <div className="mb-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="py-2">Duration</th>
                <th className="py-2">Day Type</th>
                <th className="py-2">Price</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant/20 last:border-0">
                  <td className="py-2">{r.durationMinutes} min</td>
                  <td className="py-2">{r.dayType}</td>
                  <td className="py-2">
                    {r.currency} {r.price}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rules && rules.length === 0 && <p className="mb-6 text-sm text-on-surface-variant">No pricing rules yet.</p>}

      <form onSubmit={onSubmit} className="grid grid-cols-2 gap-3 border-t border-outline-variant/20 pt-4 sm:grid-cols-4">
        {error && (
          <div className="col-span-4">
            <ErrorBanner message={error} />
          </div>
        )}
        <div>
          <Label>Duration</Label>
          <Select
            required
            value={form.durationMinutes}
            onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Day Type</Label>
          <Select value={form.dayType} onChange={(e) => setForm((f) => ({ ...f, dayType: e.target.value }))}>
            <option value="WEEKDAY">WEEKDAY</option>
            <option value="WEEKEND">WEEKEND</option>
            <option value="HOLIDAY">HOLIDAY</option>
          </Select>
        </div>
        <div>
          <Label>Price (INR)</Label>
          <Input
            required
            type="number"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add Rule'}
        </Button>
      </form>
    </Card>
  );
}

function OperatingHoursSection({ venueId }: { venueId: string }) {
  const { data: hours, refetch } = useFetch<OperatingHour[]>(`/venue-config/operating-hours?venueId=${venueId}`);
  const [savingDay, setSavingDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { openTime: string; closeTime: string }>>({});

  function draftFor(weekday: number): { openTime: string; closeTime: string } {
    if (drafts[weekday]) return drafts[weekday];
    const existing = hours?.find((h) => h.weekday === weekday);
    return existing ? { openTime: existing.openTime, closeTime: existing.closeTime } : { openTime: '06:00', closeTime: '22:00' };
  }

  async function saveDay(weekday: number) {
    setError(null);
    setSavingDay(weekday);
    try {
      const draft = draftFor(weekday);
      await api.put('/venue-config/operating-hours', { venueId, weekday, ...draft });
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save hours');
    } finally {
      setSavingDay(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-on-surface">Operating Hours</h2>
      <p className="mb-4 text-xs text-on-surface-variant">
        Set opening and closing time for each day of the week. Customers can only book within these hours.
      </p>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} />
        </div>
      )}
      {!hours ? (
        <LoadingState />
      ) : (
        <div className="space-y-2">
          {WEEKDAYS.map((label, weekday) => {
            const draft = draftFor(weekday);
            return (
              <div key={weekday} className="flex items-center gap-3">
                <span className="w-28 text-sm text-on-surface-variant">{label}</span>
                <Input
                  type="time"
                  value={draft.openTime}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [weekday]: { ...draft, openTime: e.target.value } }))
                  }
                  className="w-32"
                />
                <span className="text-on-surface-variant/50">to</span>
                <Input
                  type="time"
                  value={draft.closeTime}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [weekday]: { ...draft, closeTime: e.target.value } }))
                  }
                  className="w-32"
                />
                <Button variant="secondary" disabled={savingDay === weekday} onClick={() => saveDay(weekday)}>
                  {savingDay === weekday ? 'Saving…' : 'Save'}
                </Button>
              </div>
            );
          })}
        </div>
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

function BlockedDatesSection({ venueId, resources }: { venueId: string; resources: Resource[] }) {
  const { data: blocked, refetch } = useFetch<BlockedDate[]>(`/venue-config/blocked-dates?venueId=${venueId}`);
  const [mode, setMode] = useState<'single' | 'range'>('single');
  const [form, setForm] = useState({ resourceId: '', date: '', endDate: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
        Block a single day or a range of days. Leave &quot;Resource&quot; unset to close the entire venue —
        customers can&apos;t book, and any attempt during this window is rejected.
      </p>

      {!blocked && <LoadingState />}
      {blocked && blocked.length > 0 && (
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
              {blocked.map((b) => {
                const start = new Date(b.startTime);
                const end = new Date(b.endTime);
                const sameDay = start.toDateString() === end.toDateString();
                return (
                  <tr key={b.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">
                      {b.resourceId ? resources.find((r) => r.id === b.resourceId)?.name ?? 'Resource' : 'Whole venue'}
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
        </div>
      )}
      {blocked && blocked.length === 0 && <p className="mb-6 text-sm text-on-surface-variant">No closed days.</p>}

      <form onSubmit={onSubmit} className="space-y-3 border-t border-outline-variant/20 pt-4">
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
            <Label>{mode === 'range' ? 'From' : 'Date'}</Label>
            <Input
              required
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          {mode === 'range' && (
            <div>
              <Label>To</Label>
              <Input
                required
                type="date"
                min={form.date || undefined}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          )}
          <div>
            <Label>Resource (optional)</Label>
            <Select
              value={form.resourceId}
              onChange={(e) => setForm((f) => ({ ...f, resourceId: e.target.value }))}
            >
              <option value="">Whole venue</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Closing…' : mode === 'range' ? 'Close These Days' : 'Close This Day'}
        </Button>
      </form>
    </Card>
  );
}

interface CreatedBooking {
  id: string;
  orderId: string;
}

function BookOfflineSection({ resources, durations }: { resources: Resource[]; durations: number[] }) {
  const [form, setForm] = useState({
    resourceId: resources[0]?.id ?? '',
    date: '',
    time: '',
    durationMinutes: String(durations[0] ?? 60),
    customerWhatsappNumber: '',
    customerName: '',
    amount: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setSubmitting(true);
    try {
      const booking = await api.post<CreatedBooking>('/owner/bookings', {
        resourceId: form.resourceId,
        startTime: new Date(`${form.date}T${form.time}`).toISOString(),
        durationMinutes: Number(form.durationMinutes),
        customerWhatsappNumber: form.customerWhatsappNumber,
        customerName: form.customerName || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
      });
      setCreated(booking);
      setForm((f) => ({
        ...f,
        date: '',
        time: '',
        customerWhatsappNumber: '',
        customerName: '',
        amount: '',
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-on-surface">Book a Slot (Walk-in / Offline)</h2>
      <p className="mb-4 text-xs text-on-surface-variant">
        Records a real booking for a customer who paid you directly (cash, UPI, etc.) — it blocks the slot
        from being booked through the app, exactly like a paid online booking.
      </p>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {error && (
          <div className="col-span-2">
            <ErrorBanner message={error} />
          </div>
        )}
        {created && (
          <div className="col-span-2">
            <SuccessBanner
              message={
                <>
                  Booked as {created.orderId}.{' '}
                  <Link href={`/bookings/${created.id}`} className="font-medium underline">
                    View booking →
                  </Link>
                </>
              }
            />
          </div>
        )}

        <div>
          <Label>Resource</Label>
          <Select required value={form.resourceId} onChange={(e) => update('resourceId', e.target.value)}>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.groundType})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Duration</Label>
          <Select
            required
            value={form.durationMinutes}
            onChange={(e) => update('durationMinutes', e.target.value)}
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Date</Label>
          <Input required type="date" value={form.date} onChange={(e) => update('date', e.target.value)} />
        </div>
        <div>
          <Label>Start Time</Label>
          <Input required type="time" value={form.time} onChange={(e) => update('time', e.target.value)} />
        </div>
        <div>
          <Label>Customer WhatsApp Number</Label>
          <Input
            required
            placeholder="+91…"
            value={form.customerWhatsappNumber}
            onChange={(e) => update('customerWhatsappNumber', e.target.value)}
          />
        </div>
        <div>
          <Label>Customer Name (optional)</Label>
          <Input value={form.customerName} onChange={(e) => update('customerName', e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Amount (optional — uses your configured price if left blank)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="e.g. 800"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Button type="submit" disabled={submitting || !form.resourceId}>
            {submitting ? 'Booking…' : 'Book This Slot'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AvailabilityPage() {
  const { id } = useParams<{ id: string }>();
  const { data: resources, loading, error } = useFetch<Resource[]>(`/resources?venueId=${id}`);
  const { data: venue } = useFetch<{ category: VenueCategorySummary }>(`/venues/${id}`);
  const { data: categories } = useFetch<VenueCategory[]>('/categories');
  // The durations a venue can be priced/booked for are its type's policy,
  // not a fixed list (a chess club may sell 30-minute games).
  const durations =
    categories?.find((c) => c.id === venue?.category.id)?.policy.durations ?? null;

  return (
    <div className="space-y-6">
      <PageHeader title="Availability & Pricing" />
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {resources && resources.length === 0 && (
        <ErrorBanner message="Add at least one resource on the venue's Overview page before configuring pricing." />
      )}
      {resources && resources.length > 0 && durations && (
        <>
          <PricingRulesSection resources={resources} durations={durations} />
          <OperatingHoursSection venueId={id} />
          <BlockedDatesSection venueId={id} resources={resources} />
          <BookOfflineSection resources={resources} durations={durations} />
        </>
      )}
    </div>
  );
}
