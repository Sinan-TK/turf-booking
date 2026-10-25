'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, Label, Select } from '@/components/ui';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 14;

const dayLabel = (n: number) => (n === 1 ? '1 day (today only)' : n === DEFAULT_DAYS ? `${n} days (usual)` : n === MAX_DAYS ? `${n} days (most)` : `${n} days`);

/**
 * How far ahead customers can book this venue: today and the next (n - 1) days. It starts at 7 and the owner can
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface">Advance booking</h2>
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
            onClick={() => {
              setValue(String(days));
              setError(null);
              setEditing(true);
            }}
          >
            Change
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
    </Card>
  );
}
