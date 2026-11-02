'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { durationLabel } from '@/lib/categories';
import { Button, ErrorBanner, FieldError, Input, Label, Select, invalidClass } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';

/** The longest booking a unit may have; the API enforces the same limit. */
const DAY_MINUTES = 24 * 60;

/** The range the Super Admin allows for a venue type's bookings: a unit's lengths must stay inside it. */
export interface DurationLimits {
  name: string;
  min: number;
  max: number;
}

/** The lengths a unit can be booked for: its shortest, twice that, and so on up to the longest it could have (never past the venue type's limit). */
export function maxChoices(min: number, limitMax: number = DAY_MINUTES): number[] {
  if (!Number.isInteger(min) || min <= 0) return [];
  const out: number[] = [];
  for (let d = min; d <= Math.min(DAY_MINUTES, limitMax) && out.length < 24; d += min) out.push(d);
  return out;
}

/** The longest booking to suggest for a new shortest one: keep the current longest if it still fits, else the nearest below. */
export function fitMax(min: number, max: number): number {
  return Math.max(min, Math.floor(max / min) * min);
}

/** The facility's own shortest and longest booking, used to start a new unit from. The owner can change both. */
export function defaultDurations(policy: { minDurationMin: number; maxDurationMin: number }): { min: number; max: number } {
  return { min: policy.minDurationMin, max: fitMax(policy.minDurationMin, policy.maxDurationMin) };
}

export function durationsError(min: number, max: number, limits?: DurationLimits): { min?: string; max?: string } {
  if (!Number.isInteger(min) || min <= 0) return { min: 'Enter the shortest booking in minutes.' };
  if (min > DAY_MINUTES) return { min: `The shortest booking can't be more than ${DAY_MINUTES} minutes.` };
  if (limits && (min < limits.min || min > limits.max)) {
    return { min: `${limits.name} bookings can be from ${durationLabel(limits.min)} to ${durationLabel(limits.max)}.` };
  }
  if (limits && max > limits.max) return { max: `The longest booking can't be more than ${durationLabel(limits.max)} for ${limits.name}.` };
  if (!Number.isInteger(max) || max < min || max % min !== 0) return { max: `The longest booking must be a multiple of ${min} minutes.` };
  return {};
}

/**
 * The two fields that set how long a unit can be booked: the shortest booking (also the block its prices are for) and
 * the longest, which is always a whole number of those blocks.
 */
export function DurationFields({
  idPrefix,
  min,
  max,
  onChange,
  errors,
  limits,
}: {
  idPrefix: string;
  min: number;
  max: number;
  onChange: (next: { min: number; max: number }) => void;
  errors?: { min?: string; max?: string };
  /** What the Super Admin allows for this venue type; the longest booking can't go past it. */
  limits?: DurationLimits;
}) {
  const choices = maxChoices(min, limits?.max);
  return (
    <>
      <div>
        <Label htmlFor={`${idPrefix}-min`}>Shortest booking (minutes)</Label>
        <Input
          id={`${idPrefix}-min`}
          type="number"
          inputMode="numeric"
          min={1}
          max={DAY_MINUTES}
          aria-invalid={!!errors?.min}
          className={errors?.min ? invalidClass : ''}
          value={Number.isFinite(min) ? min : ''}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange({ min: next, max: Number.isInteger(next) && next > 0 ? Math.min(fitMax(next, max), limits ? Math.max(next, Math.floor(limits.max / next) * next) : DAY_MINUTES) : max });
          }}
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          Prices are per {Number.isFinite(min) && min > 0 ? durationLabel(min) : 'this length'}.
          {limits && ` ${limits.name} bookings can be ${durationLabel(limits.min)} to ${durationLabel(limits.max)}.`}
        </p>
        <FieldError id={`${idPrefix}-min-error`} message={errors?.min} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-max`}>Longest booking</Label>
        <Select
          id={`${idPrefix}-max`}
          aria-invalid={!!errors?.max}
          className={errors?.max ? invalidClass : ''}
          value={String(max)}
          onChange={(e) => onChange({ min, max: Number(e.target.value) })}
        >
          {choices.map((d) => (
            <option key={d} value={d}>
              {durationLabel(d)}
            </option>
          ))}
        </Select>
        <FieldError id={`${idPrefix}-max-error`} message={errors?.max} />
      </div>
    </>
  );
}

/** A unit's current booking lengths, with a small form to change them (saves straight away). */
export function UnitDurations({
  unitId,
  min,
  max,
  hasPrices,
  onSaved,
  limits,
}: {
  limits?: DurationLimits;
  unitId: string;
  min: number;
  max: number;
  /** Whether the unit already has prices: they are per block of the shortest booking, so changing it needs a re-check. */
  hasPrices: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ min, max });
  const [errors, setErrors] = useState<{ min?: string; max?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const found = durationsError(form.min, form.max, limits);
    setErrors(found);
    if (found.min || found.max) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/resources/${unitId}/durations`, { minDurationMinutes: form.min, maxDurationMinutes: form.max });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the booking lengths.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-3 py-1.5 text-sm font-medium text-on-surface">
          <SvgIcon name="clock" className="h-4 w-4 text-primary" />
          Booked for {durationLabel(min)}
          {max > min ? ` up to ${durationLabel(max)}` : ''}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-surface-container-lowest px-3 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={() => {
            setForm({ min, max });
            setErrors({});
            setError(null);
            setEditing(true);
          }}
        >
          <SvgIcon name="edit" className="h-4 w-4" />
          Change length
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-outline-variant/40 bg-surface-container-low p-3">
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DurationFields idPrefix={`unit-${unitId}`} min={form.min} max={form.max} onChange={setForm} errors={errors} limits={limits} />
      </div>
      {hasPrices && form.min !== min && (
        <p className="text-xs text-amber-700">
          This unit&apos;s prices are per {durationLabel(min)}. After this change they mean per{' '}
          {Number.isFinite(form.min) && form.min > 0 ? durationLabel(form.min) : 'the new length'}, so check them on the prices page.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
