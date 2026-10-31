'use client';

import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { PhotoCropper } from '@/components/photo-cropper';

/**
 * A facility's picture, shown to customers in the "Venue types" picker. It saves straight away (not with the form's Save), and is
 * kept in its own folder in storage. Needs the facility to exist, so a new one shows a hint until it has been saved once.
 */
export function FacilityPicture({ categoryId, initialUrl }: { categoryId?: string; initialUrl?: string | null }) {
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // The picked file, waiting in the cropper.
  const [cropping, setCropping] = useState<File | null>(null);

  async function run(kind: 'upload' | 'remove', action: () => Promise<{ imageUrl: string | null }>) {
    setBusy(kind);
    setError(null);
    try {
      setUrl((await action()).imageUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again should still fire
    if (!file || !categoryId) return;
    if (!file.type.startsWith('image/')) return setError('Choose a picture (JPEG, PNG or WebP).');
    setError(null);
    setCropping(file);
  }

  /** The framed picture from the cropper: already the picker's shape, WebP and at most 1200px wide. */
  function upload(picture: Blob) {
    setCropping(null);
    void run('upload', () => {
      const form = new FormData();
      form.append('file', picture, picture.type === 'image/webp' ? 'facility.webp' : 'facility.jpg');
      return api.upload<{ imageUrl: string | null }>(`/admin/categories/${categoryId}/image`, form);
    });
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-700">Picture</p>
      <p className="mb-2 text-xs text-gray-500">
        Shown with this facility in the customer site&apos;s &quot;Venue types&quot; picker. JPEG, PNG or WebP; you frame it before it is uploaded.
      </p>
      {!categoryId ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-xs text-gray-500">Save the facility first, then add its picture here.</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400">
            {url ? <img src={url} alt="Facility picture" className="h-full w-full object-cover" /> : 'No picture'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPick} aria-label="Choose a facility picture" />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === 'upload' ? 'Uploading…' : url ? 'Replace picture' : 'Upload picture'}
            </button>
            {url && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run('remove', () => api.delete<{ imageUrl: string | null }>(`/admin/categories/${categoryId}/image`))}
                className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
              >
                {busy === 'remove' ? 'Removing…' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      )}
      {cropping && <PhotoCropper file={cropping} onCancel={() => setCropping(null)} onCropped={upload} />}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
