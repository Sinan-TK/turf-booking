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
export function UnitPhotos({ unitId, unitName, initial, basePath }: { unitId: string; unitName: string; initial: UnitPhoto[]; basePath?: string }) {
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

  const makeMain = (photo: UnitPhoto) =>
    run(photo.id, () =>
      api.put<UnitPhoto[]>(`${base}/photos/order`, {
        photoIds: [photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)],
      }),
    );
  const remove = (photo: UnitPhoto) => run(photo.id, () => api.delete<UnitPhoto[]>(`${base}/photos/${photo.id}`));

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((photo, i) => (
          <figure key={photo.id} className="group relative h-14 w-32 overflow-hidden rounded-lg bg-surface-container ring-1 ring-outline-variant/40">
            <img src={photo.url} alt={`${unitName} photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 && (
              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">Main</span>
            )}
            {busy === photo.id && <span className="absolute inset-0 animate-pulse bg-white/60" aria-hidden="true" />}
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent p-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              {i > 0 && (
                <button
                  type="button"
                  onClick={() => void makeMain(photo)}
                  disabled={busy !== null}
                  title="Make this the main photo"
                  aria-label={`Make photo ${i + 1} the main photo of ${unitName}`}
                  className="rounded bg-white/90 p-1 text-amber-600 hover:bg-white disabled:opacity-50"
                >
                  <SvgIcon name="star" className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void remove(photo)}
                disabled={busy !== null}
                title="Remove photo"
                aria-label={`Remove photo ${i + 1} of ${unitName}`}
                className="rounded bg-white/90 p-1 text-red-600 hover:bg-white disabled:opacity-50"
              >
                <SvgIcon name="trash" className="h-3.5 w-3.5" />
              </button>
            </div>
          </figure>
        ))}
        {photos.length < MAX_UNIT_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy !== null}
            className="flex h-14 w-32 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-outline-variant text-[11px] font-medium text-on-surface-variant transition hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {busy === 'upload' ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-outline-variant border-t-primary" aria-hidden="true" />
            ) : (
              <SvgIcon name="image" className="h-4 w-4" />
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
