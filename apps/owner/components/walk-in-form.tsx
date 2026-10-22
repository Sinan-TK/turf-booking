'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { durationLabel, type VenueCategory } from '@/lib/categories';
import { Button, Card, ErrorBanner, FieldError, Input, Label, Select, SuccessBanner, invalidClass } from '@/components/ui';
import { hasErrors, numberError, phoneError, type FieldErrors } from '@/lib/validation';

export interface WalkInResource {
  id: string;
  name: string;
  groundType: string;
  category: { id: string; name: string };
}

/**
 * The durations a unit can be booked for are its own facility's policy (a pool may sell 1-hour swims
 * while chess sells 30-minute games), not one list for the whole venue.
 */
export function durationsFor(categories: VenueCategory[], resource: WalkInResource | undefined): number[] {
  const own = categories.find((c) => c.id === resource?.category.id)?.policy.durations;
  return own && own.length > 0 ? own : [60];
}

interface CreatedBooking {
  id: string;
  orderId: string;
}

export function WalkInForm({
  resources,
  categories,
}: {
  resources: WalkInResource[];
  categories: VenueCategory[];
}) {
  const [form, setForm] = useState({
    resourceId: resources[0]?.id ?? '',
    date: '',
    time: '',
    durationMinutes: String(durationsFor(categories, resources[0])[0] ?? 60),
    customerWhatsappNumber: '',
    customerName: '',
    amount: '',
    amountPaid: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<keyof typeof form>>({});

  const durations = durationsFor(
    categories,
    resources.find((r) => r.id === form.resourceId),
  );

  // Switching to a unit of another facility: keep the duration valid for it.
  useEffect(() => {
    setForm((f) =>
      durations.includes(Number(f.durationMinutes))
        ? f
        : { ...f, durationMinutes: String(durations[0]) },
    );
  }, [durations]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((p) => (p[key] ? { ...p, [key]: undefined } : p));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const found: FieldErrors<keyof typeof form> = {
      resourceId: form.resourceId ? undefined : 'Select a unit.',
      date: form.date ? undefined : 'Choose the date.',
      time: form.time ? undefined : 'Choose the start time.',
      customerWhatsappNumber: phoneError(form.customerWhatsappNumber),
      customerName: form.customerName.length > 100 ? 'Keep the name to 100 characters.' : undefined,
      amount: form.amount.trim() === '' ? undefined : numberError(form.amount, 'Amount', 0, 1_000_000),
      amountPaid:
        form.amountPaid.trim() === ''
          ? undefined
          : (numberError(form.amountPaid, 'Amount collected', 0, 1_000_000) ??
            (form.amount.trim() !== '' && Number(form.amountPaid) > Number(form.amount)
              ? 'The amount collected can\u2019t be more than the booking amount.'
              : undefined)),
    };
    setErrors(found);
    if (hasErrors(found)) return;
    setSubmitting(true);
    try {
      const booking = await api.post<CreatedBooking>('/owner/bookings', {
        resourceId: form.resourceId,
        startTime: new Date(`${form.date}T${form.time}`).toISOString(),
        durationMinutes: Number(form.durationMinutes),
        customerWhatsappNumber: form.customerWhatsappNumber,
        customerName: form.customerName || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
        amountPaid: form.amountPaid.trim() === '' ? undefined : Number(form.amountPaid),
      });
      setCreated(booking);
      setForm((f) => ({
        ...f,
        date: '',
        time: '',
        customerWhatsappNumber: '',
        customerName: '',
        amount: '',
        amountPaid: '',
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create booking');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-on-surface">
        Book a Slot (Walk-in / Offline)
      </h2>
      <p className="mb-4 text-xs text-on-surface-variant">
        Records a real booking for a customer who paid you directly (cash, UPI, etc.) — it blocks
        the slot from being booked through the app, exactly like a paid online booking.
      </p>

      <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <Label htmlFor="walkin-resourceId">Resource</Label>
          <Select
            id="walkin-resourceId"
            aria-invalid={!!errors.resourceId}
            className={errors.resourceId ? invalidClass : ''}
            value={form.resourceId}
            onChange={(e) => update('resourceId', e.target.value)}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.category.name}
                {r.groundType ? ` (${r.groundType})` : ''}
              </option>
            ))}
          </Select>
          <FieldError id="walkin-resourceId-error" message={errors.resourceId} />
        </div>
        <div>
          <Label>Duration</Label>
          <Select
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
          <Label htmlFor="walkin-date">Date</Label>
          <Input
            id="walkin-date"
            type="date"
            aria-invalid={!!errors.date}
            className={errors.date ? invalidClass : ''}
            value={form.date}
            onChange={(e) => update('date', e.target.value)}
          />
          <FieldError id="walkin-date-error" message={errors.date} />
        </div>
        <div>
          <Label htmlFor="walkin-time">Start Time</Label>
          <Input
            id="walkin-time"
            type="time"
            aria-invalid={!!errors.time}
            className={errors.time ? invalidClass : ''}
            value={form.time}
            onChange={(e) => update('time', e.target.value)}
          />
          <FieldError id="walkin-time-error" message={errors.time} />
        </div>
        <div>
          <Label htmlFor="walkin-phone">Customer WhatsApp Number</Label>
          <Input
            id="walkin-phone"
            type="tel"
            placeholder="+91…"
            aria-invalid={!!errors.customerWhatsappNumber}
            className={errors.customerWhatsappNumber ? invalidClass : ''}
            value={form.customerWhatsappNumber}
            onChange={(e) => update('customerWhatsappNumber', e.target.value)}
          />
          <FieldError id="walkin-phone-error" message={errors.customerWhatsappNumber} />
        </div>
        <div>
          <Label htmlFor="walkin-name">Customer Name (optional)</Label>
          <Input
            id="walkin-name"
            aria-invalid={!!errors.customerName}
            className={errors.customerName ? invalidClass : ''}
            value={form.customerName}
            onChange={(e) => update('customerName', e.target.value)}
          />
          <FieldError id="walkin-name-error" message={errors.customerName} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="walkin-amount">Amount (optional — uses your configured price if left blank)</Label>
          <Input
            id="walkin-amount"
            type="number"
            step="0.01"
            placeholder="e.g. 800"
            aria-invalid={!!errors.amount}
            className={errors.amount ? invalidClass : ''}
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
          />
          <FieldError id="walkin-amount-error" message={errors.amount} />
        </div>
        <div className="col-span-2">
          <Label htmlFor="walkin-paid">Collected now (optional — leave blank if they paid it all)</Label>
          <Input
            id="walkin-paid"
            type="number"
            step="0.01"
            placeholder="e.g. 200 for an advance"
            aria-invalid={!!errors.amountPaid}
            className={errors.amountPaid ? invalidClass : ''}
            value={form.amountPaid}
            onChange={(e) => update('amountPaid', e.target.value)}
          />
          <FieldError id="walkin-paid-error" message={errors.amountPaid} />
          <p className="mt-1 text-xs text-on-surface-variant">
            Whatever is not collected now shows as remaining on the booking, and you can record it later.
          </p>
        </div>
        <div className="col-span-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Booking…' : 'Book This Slot'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

