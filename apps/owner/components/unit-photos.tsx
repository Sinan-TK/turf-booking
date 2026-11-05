'use client';

import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { SvgIcon } from '@/components/svg-icons';
import { PhotoCropper } from '@/components/photo-cropper';

export interface UnitPhoto {
  id: string;
  url: string;
}

/** A unit shows at most this many photos to customers (the API enforces it too). */
export const MAX_UNIT_PHOTOS = 3;

/**
 * The photos of one unit (pitch, court, table…) or one pooled item (a kayak fleet), as customers see them on the venue card: up to three, the first
 * being the main picture. The owner adds (framing each one in the cropper first), removes and picks the main one here;
 * every change saves straight away.
 */
export function UnitPhotos({ unitId, unitName, initial, basePath, onChanged }: { unitId: string; unitName: string; initial: UnitPhoto[]; basePath?: string; onChanged?: () => void }) {
  // A unit's photos live under /resources/:id, a pooled group's under /resources/groups/:id.
  const base = basePath ?? `/resources/${unitId}`;
  const [photos, setPhotos] = useState<UnitPhoto[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picked file, waiting in the cropper.
  const [cropping, setCropping] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function run(label: string, action: () => Promise<UnitPhoto[]>) {
    setBusy(label);
    setError(null);
    try {
      setPhotos(await action());
      // The page's own copy of this unit is now out of date: read it again, so coming back to this unit shows the new photos.
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again should still fire
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Choose a photo (JPEG, PNG or WebP).');
    setError(null);
    setCropping(file);
  }

  /** The framed photo from the cropper: already the card's shape, WebP and at most 1600px wide. */
  function upload(photo: Blob) {
    setCropping(null);
    void run('upload', () => {
      const form = new FormData();
      form.append('file', photo, photo.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
      return api.upload<UnitPhoto[]>(`${base}/photos`, form);
    });
  }

  /** Shows the new order or the removal at once, then takes the server's list; if the server refuses, the photos go back as they were. */
  async function change(next: UnitPhoto[], action: () => Promise<UnitPhoto[]>) {
    const before = photos;
    setPhotos(next);
    setError(null);
    try {
      setPhotos(await action());
      onChanged?.();
    } catch (err) {
      setPhotos(before);
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  const makeMain = (photo: UnitPhoto) =>
    change([photo, ...photos.filter((p) => p.id !== photo.id)], () =>
      api.put<UnitPhoto[]>(`${base}/photos/order`, {
        photoIds: [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)],
      }),
    );
  const remove = (photo: UnitPhoto) =>
    change(
      photos.filter((p) => p.id !== photo.id),
      () => api.delete<UnitPhoto[]>(`${base}/photos/${photo.id}`),
    );

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((photo, i) => (
          <figure key={photo.id} className="group relative h-32 w-52 overflow-hidden rounded-xl bg-surface-container shadow-sm ring-1 ring-outline-variant/50 sm:h-36 sm:w-60">
            <img src={photo.url} alt={`${unitName} photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-semibold text-on-primary shadow">
                <SvgIcon name="star" className="h-3 w-3" />
                Main
              </span>
            )}
            {busy === photo.id && <span className="absolute inset-0 animate-pulse bg-white/60" aria-hidden="true" />}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-2">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => void makeMain(photo)}
                  disabled={busy !== null}
                  title="Make this the main photo"
                  aria-label={`Make photo ${i + 1} the main photo of ${unitName}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 shadow hover:bg-amber-50 disabled:opacity-50"
                >
                  <SvgIcon name="star" className="h-4 w-4" />
                  Make main
                </button>
              )}
              <button
                type="button"
                onClick={() => void remove(photo)}
                disabled={busy !== null}
                title="Remove photo"
                aria-label={`Remove photo ${i + 1} of ${unitName}`}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 shadow hover:bg-red-50 disabled:opacity-50"
              >
                <SvgIcon name="trash" className="h-4 w-4" />
                Remove
              </button>
            </div>
          </figure>
        ))}
        {photos.length < MAX_UNIT_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy !== null}
            className="flex h-32 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/10 disabled:opacity-60 sm:h-36 sm:w-60"
          >
            {busy === 'upload' ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-outline-variant border-t-primary" aria-hidden="true" />
            ) : (
              <SvgIcon name="camera" className="h-7 w-7" />
            )}
            {busy === 'upload' ? 'Uploading…' : photos.length === 0 ? 'Add photo' : `Add (${photos.length}/${MAX_UNIT_PHOTOS})`}
          </button>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
      </div>
      {cropping && <PhotoCropper file={cropping} onCancel={() => setCropping(null)} onCropped={upload} />}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
