'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorBanner, Label, Select } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 14;

const dayLabel = (n: number) => {
  if (n === 1) return '1 day (today only)';
  const notes = [n === DEFAULT_DAYS && 'usual', n === MAX_DAYS && 'most'].filter(Boolean);
  return notes.length ? `${n} days (${notes.join(', ')})` : `${n} days`;
};

/**
 * How far ahead customers can book this venue, as a row of the venue's details with an Edit button: today and the next (n - 1) days. It starts at 14 and the owner can
 * pick anything from 1 to 14. The customer site lists exactly that many days to choose from.
 */
export function VenueAdvanceBooking({ venueId, days, onSaved }: { venueId: string; days: number; onSaved: (days: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(days));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.patch<{ advanceBookingDays: number }>(`/venues/${venueId}`, { advanceBookingDays: Number(value) });
      onSaved(saved.advanceBookingDays);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">Advance booking</h3>
          {!editing && (
            <p className="mt-1 text-body-md text-on-surface-variant">
              Customers can book up to <strong className="text-on-surface">{days === 1 ? '1 day' : `${days} days`}</strong> ahead
              {days === 1 ? ': today only.' : `: today and the next ${days - 1} days.`}
            </p>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            aria-label="Edit advance booking"
            className="inline-flex items-center gap-1.5 !px-3 !py-1.5"
            onClick={() => {
              setValue(String(days));
              setError(null);
              setEditing(true);
            }}
          >
            <SvgIcon name="edit" className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>

      {editing && (
        <form
          noValidate
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="max-w-xs">
            <Label htmlFor="advance-days">Customers can book up to</Label>
            <Select id="advance-days" value={value} onChange={(e) => setValue(e.target.value)}>
              {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {dayLabel(n)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-on-surface-variant">Today counts as the first day. The most you can offer is 14 days.</p>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
