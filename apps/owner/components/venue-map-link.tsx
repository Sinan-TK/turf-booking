'use client';

import { useState } from 'react';
import { googleMapsUrlProblem } from '@venue/shared/dist/maps-url';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorBanner, FieldError, Input, Label, invalidClass } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';

/**
 * The venue's Google Maps link, as a row of the venue's details with an Edit button: what its Directions button opens for customers. Without one, Directions uses the
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
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">Google Maps link</h3>
          {!editing && (
            <p className="mt-1 text-body-md text-on-surface-variant">
              {link ? (
                <>
                  Customers&apos; Directions button opens{' '}
                  <a href={googleMapsUrlProblem(link) === undefined ? link : undefined} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
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
            aria-label="Edit Google Maps link"
            className="inline-flex items-center gap-1.5 !px-3 !py-1.5"
            onClick={() => {
              setValue(link ?? '');
              setFieldError(undefined);
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
            <p className="mt-1 text-xs text-on-surface-variant">
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
    </div>
  );
}
