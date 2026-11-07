'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { SvgIcon } from '@/components/svg-icons';
import { PhotoCropper } from '@/components/photo-cropper';
import { Modal } from '@/components/modal';

export interface UnitPhoto {
  id: string;
  url: string;
}

/** A photo the owner already has on another unit, with where it is used. */
interface LibraryPhoto extends UnitPhoto {
  from: string;
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
  // The page reads this unit again after every change (and when it first arrives): whenever what it holds differs from what was last
  // taken over, take it over, so a unit mounted before its photos had loaded, or changed elsewhere, never stays out of date.
  const initialKey = initial.map((p) => `${p.id}:${p.url}`).join('|');
  const taken = useRef(initialKey);
  useEffect(() => {
    if (taken.current === initialKey) return;
    taken.current = initialKey;
    setPhotos(initial);
  }, [initialKey]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The picked file, waiting in the cropper.
  const [cropping, setCropping] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The picker of photos the owner already has on other units: null while closed.
  const [library, setLibrary] = useState<LibraryPhoto[] | null | 'loading'>(null);

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

  /** Opens the picker of photos already on the owner's other units and pooled items (across all their venues). */
  async function openLibrary() {
    setError(null);
    setLibrary('loading');
    try {
      setLibrary(await api.get<LibraryPhoto[]>(`${base}/photos/library`));
    } catch (err) {
      setLibrary(null);
      setError(err instanceof ApiError ? err.message : 'Could not load your photos.');
    }
  }

  /** Uses one of those photos here: the same stored picture, so nothing is uploaded again. */
  function reuse(photo: LibraryPhoto) {
    setLibrary(null);
    void run('reuse', () => api.post<UnitPhoto[]>(`${base}/photos/reuse`, { photoId: photo.id }));
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
              <HoldToDelete
                label={`Remove photo ${i + 1} of ${unitName}`}
                disabled={busy !== null}
                onHold={() => void remove(photo)}
                onTap={() => setError('Press and hold Remove to delete this photo.')}
              />
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
        {photos.length < MAX_UNIT_PHOTOS && (
          <button
            type="button"
            onClick={() => void openLibrary()}
            disabled={busy !== null || library === 'loading'}
            className="flex h-32 w-52 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low px-3 text-center text-sm font-semibold text-on-surface transition hover:border-primary/60 hover:bg-surface-container disabled:opacity-60 sm:h-36 sm:w-60"
          >
            {busy === 'reuse' || library === 'loading' ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-outline-variant border-t-primary" aria-hidden="true" />
            ) : (
              <SvgIcon name="image" className="h-7 w-7" />
            )}
            {busy === 'reuse' ? 'Adding…' : 'Use a photo you already have'}
            <span className="text-xs font-normal text-on-surface-variant">from your other units</span>
          </button>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} />
      </div>
      {cropping && <PhotoCropper file={cropping} onCancel={() => setCropping(null)} onCropped={upload} />}
      {Array.isArray(library) && (
        <Modal
          title="Use a photo you already have"
          subtitle={`Pick one from your other units or pooled items. It is shared, so ${unitName} shows the same picture without it being uploaded again.`}
          onClose={() => setLibrary(null)}
        >
          <div className="p-6">
            {library.length === 0 ? (
              <p className="rounded-xl bg-surface-container-low px-4 py-8 text-center text-sm text-on-surface-variant">
                You have no other photos to use yet. Add a photo to one of your units first, then it can be used here.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos you already have">
                {library.map((photo) => (
                  <li key={photo.id}>
                    <button
                      type="button"
                      onClick={() => reuse(photo)}
                      className="group block w-full overflow-hidden rounded-xl bg-surface-container text-left shadow-sm ring-1 ring-outline-variant/50 transition hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <img src={photo.url} alt={`Photo from ${photo.from}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                      <span className="block truncate px-2.5 py-2 text-xs font-medium text-on-surface">{photo.from}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

const HOLD_MS = 1000;

/**
 * Deleting a photo is final (its file is deleted from storage), so the button has to be held: red fills it from the left, and the photo is
 * deleted when it is full. Letting go early empties it again and deletes nothing. Space and Enter hold it too.
 */
function HoldToDelete({ label, disabled, onHold, onTap }: { label: string; disabled: boolean; onHold: () => void; onTap: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onHold();
    }, HOLD_MS);
  };
  const stop = (early: boolean) => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    if (early) onTap();
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <button
      type="button"
      disabled={disabled}
      title="Press and hold to delete this photo"
      aria-label={label}
      aria-description="Press and hold to delete"
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={() => stop(true)}
      onPointerLeave={() => stop(false)}
      onPointerCancel={() => stop(false)}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop(true);
      }}
      onBlur={() => stop(false)}
      onContextMenu={(e) => e.preventDefault()}
      className="relative inline-flex touch-none select-none items-center gap-1 overflow-hidden rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 shadow hover:bg-red-50 disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-red-600 ease-linear"
        style={{ width: holding ? '100%' : '0%', transitionProperty: 'width', transitionDuration: holding ? `${HOLD_MS}ms` : '150ms' }}
      />
      <span className={`relative inline-flex items-center gap-1 transition-colors ${holding ? 'text-white' : ''}`}>
        <SvgIcon name="trash" className="h-4 w-4" />
        Hold to delete
      </span>
    </button>
  );
}
