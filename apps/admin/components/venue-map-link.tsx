'use client';

import { useState } from 'react';
import { googleMapsUrlProblem } from '@venue/shared/dist/maps-url';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';

/**
 * The venue's Google Maps link: what its Directions button opens for customers. Without one, Directions uses the
 * map pin (latitude and longitude) instead.
 */
export function VenueMapLink({
  venueId,
  link,
  onSaved,
}: {
  venueId: string;
  link: string | null;
  onSaved: (link: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(link ?? '');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    const problem = googleMapsUrlProblem(next);
    setFieldError(problem);
    setError(null);
    if (problem) return;
    setSaving(true);
    try {
      const saved = await api.patch<{ googleMapsUrl: string | null }>(`/venues/${venueId}`, { googleMapsUrl: next.trim() || null });
      onSaved(saved.googleMapsUrl);
      setValue(saved.googleMapsUrl ?? '');
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the link');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Google Maps link</h2>
          {!editing && (
            <p className="mt-1 text-sm text-gray-500">
              {link ? (
                <>
                  Customers&apos; Directions button opens{' '}
                  <a href={googleMapsUrlProblem(link) === undefined ? link : undefined} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">
                    {link}
                  </a>
                  .
                </>
              ) : (
                'None. The Directions button uses your map pin instead.'
              )}
            </p>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setValue(link ?? '');
              setFieldError(undefined);
              setEditing(true);
            }}
          >
            {link ? 'Change link' : 'Add a link'}
          </Button>
        )}
      </div>

      {editing && (
        <form
          noValidate
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(value);
          }}
        >
          <div>
            <Label htmlFor="map-link">Link</Label>
            <Input
              id="map-link"
              type="url"
              inputMode="url"
              placeholder="https://maps.app.goo.gl/…"
              aria-invalid={!!fieldError}
              className={fieldError ? invalidClass : ''}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(undefined);
              }}
            />
            <FieldError id="map-link-error" message={fieldError} />
            <p className="mt-1 text-xs text-gray-500">
              Open your place in Google Maps, choose Share, then Copy link. Leave it empty to use the map pin.
            </p>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save link'}
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {link && (
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void save('')}>
                Remove link
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
