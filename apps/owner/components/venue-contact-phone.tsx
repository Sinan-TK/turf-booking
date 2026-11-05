'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorBanner, Input, Label } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';

/**
 * The number a customer with a confirmed booking can call, as a row of the venue's details with an Edit button. Left empty, the owner
 * organization's own contact number is shown instead, so every venue has one. It is never shown to people who have not booked.
 */
export function VenueContactPhone({
  venueId,
  phone,
  fallback,
  onSaved,
}: {
  venueId: string;
  phone: string | null;
  /** The organization's contact number, used while this is empty. */
  fallback?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/venues/${venueId}`, { contactPhone: value.trim() === '' ? null : value.trim() });
      onSaved();
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
          <h3 className="text-sm font-semibold text-on-surface">Contact number</h3>
          {!editing && (
            <p className="mt-1 text-body-md text-on-surface-variant">
              {phone ? (
                <strong className="text-on-surface">{phone}</strong>
              ) : (
                <>Your organization&apos;s number{fallback ? <> (<strong className="text-on-surface">{fallback}</strong>)</> : null} is used.</>
              )}{' '}
              Customers see it, with a Call button, once their booking is confirmed.
            </p>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            aria-label="Edit contact number"
            className="inline-flex items-center gap-1.5 !px-3 !py-1.5"
            onClick={() => {
              setValue(phone ?? '');
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
            <Label htmlFor="venue-contact-phone">Mobile number</Label>
            <Input
              id="venue-contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="98470 12345"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <p className="mt-1 text-xs text-on-surface-variant">An Indian mobile number. Leave it empty to use your organization&apos;s number.</p>
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
