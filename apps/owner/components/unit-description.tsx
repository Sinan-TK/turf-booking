'use client';

import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorBanner, FieldError, Label } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';

const MAX = 2000;

/**
 * One unit's description, with an Edit button: what customers read about this court, turf or pooled item when they pick it on the booking page.
 * A line or two is enough.
 */
export function UnitDescription({ path, unitName, description, onSaved }: { path: string; unitName: string; description: string | null; onSaved: (description: string | null) => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(description ?? '');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const problem = value.length > MAX ? `Keep the description to ${MAX} characters.` : undefined;
    setFieldError(problem);
    setError(null);
    if (problem) return;
    setSaving(true);
    try {
      const saved = await api.patch<{ description: string | null }>(path, { description: value.trim() });
      onSaved(saved.description || null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the description');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-on-surface">Description</h3>
          {!editing && (
            <p className="mt-1 whitespace-pre-line text-body-md text-on-surface-variant">
              {description ? description : 'None yet. Add a few points about this unit, one per line. Customers read them as a list on the booking page.'}
            </p>
          )}
        </div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            aria-label={`Edit description of ${unitName}`}
            className="inline-flex items-center gap-1.5 !px-3 !py-1.5"
            onClick={() => {
              setValue(description ?? '');
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
            void save();
          }}
        >
          <div>
            <Label htmlFor={id}>About this unit</Label>
            <p className="mb-1.5 text-xs text-on-surface-variant">Press Enter after each point. Customers see every line as its own bullet point.</p>
            <textarea
              id={id}
              rows={4}
              value={value}
              aria-invalid={!!fieldError}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(undefined);
              }}
              placeholder={'Floodlit 5-a-side turf\nRubber surface, bring your own shoes\nChanging rooms and parking'}
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/60 hover:border-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <div className="mt-1 flex items-start justify-between gap-3">
              <FieldError id={`${id}-error`} message={fieldError} />
              <p className="ml-auto shrink-0 text-xs text-on-surface-variant">
                {value.length}/{MAX}
              </p>
            </div>
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
