'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { durationLabel } from '@/lib/categories';
import { Button, ErrorBanner, FieldError, Input, Label, Select, invalidClass } from '@/components/ui';

/** The longest booking a unit may have; the API enforces the same limit. */
const DAY_MINUTES = 24 * 60;

/** The lengths a unit can be booked for: its shortest, twice that, and so on up to the longest it could have. */
export function maxChoices(min: number): number[] {
  if (!Number.isInteger(min) || min <= 0) return [];
  const out: number[] = [];
  for (let d = min; d <= DAY_MINUTES && out.length < 24; d += min) out.push(d);
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

export function durationsError(min: number, max: number): { min?: string; max?: string } {
  if (!Number.isInteger(min) || min <= 0) return { min: 'Enter the shortest booking in minutes.' };
  if (min > DAY_MINUTES) return { min: `The shortest booking can't be more than ${DAY_MINUTES} minutes.` };
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
}: {
  idPrefix: string;
  min: number;
  max: number;
  onChange: (next: { min: number; max: number }) => void;
  errors?: { min?: string; max?: string };
}) {
  const choices = maxChoices(min);
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
            onChange({ min: next, max: Number.isInteger(next) && next > 0 ? fitMax(next, max) : max });
          }}
        />
        <p className="mt-1 text-xs text-on-surface-variant">Prices are per {Number.isFinite(min) && min > 0 ? durationLabel(min) : 'this length'}.</p>
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
}: {
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
    const found = durationsError(form.min, form.max);
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
      <p className="flex flex-wrap items-center gap-x-3 text-xs text-on-surface-variant">
        <span>
          Booked for {durationLabel(min)}
          {max > min ? ` up to ${durationLabel(max)}` : ''}
        </span>
        <button
          type="button"
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={() => {
            setForm({ min, max });
            setErrors({});
            setError(null);
            setEditing(true);
          }}
        >
          Change length
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-outline-variant/40 bg-surface-container-low p-3">
      {error && <ErrorBanner message={error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DurationFields idPrefix={`unit-${unitId}`} min={form.min} max={form.max} onChange={setForm} errors={errors} />
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
