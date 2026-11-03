'use client';

import { useEffect, useRef, useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { optimistic } from '@/lib/optimistic';
import { Badge, Button, Card, EmptyState, ErrorBanner, FieldError, Input, Label, PageHeader, SkeletonText, invalidClass } from '@/components/ui';
import { Modal } from '@/components/modal';
import { PhotoCropper } from '@/components/photo-cropper';
import { hasErrors, intError, textError, type FieldErrors } from '@/lib/validation';

interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  sortOrder: number;
  live: boolean;
  scheduled: boolean;
  ended: boolean;
}

/** Wide banner: 16 across to 5 down, so what is framed here is what the landing page shows. */
const BANNER_ASPECT = 16 / 5;

/** "2026-11-02T18:30" in the person's own time, for a datetime-local box; and back to a moment in time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

function statusOf(b: Banner): string {
  if (!b.isActive) return 'INACTIVE';
  if (b.ended) return 'ENDED';
  if (b.scheduled) return 'SCHEDULED';
  return 'ACTIVE';
}

type Picture = { kind: 'keep' } | { kind: 'remove' } | { kind: 'new'; blob: Blob; preview: string };

function BannerDialog({ banner, onClose, onSaved }: { banner: Banner | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    title: banner?.title ?? '',
    subtitle: banner?.subtitle ?? '',
    linkUrl: banner?.linkUrl ?? '',
    startsAt: toLocalInput(banner?.startsAt ?? null),
    endsAt: toLocalInput(banner?.endsAt ?? null),
    sortOrder: String(banner?.sortOrder ?? 0),
    isActive: banner?.isActive ?? true,
  });
  const [picture, setPicture] = useState<Picture>({ kind: 'keep' });
  const [cropping, setCropping] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors<'title' | 'linkUrl' | 'endsAt' | 'sortOrder' | 'picture'>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // The framed picture's preview is a temporary address: released when it is replaced or the dialog closes.
  useEffect(() => {
    return () => {
      if (picture.kind === 'new') URL.revokeObjectURL(picture.preview);
    };
  }, [picture]);

  const shownPicture = picture.kind === 'new' ? picture.preview : picture.kind === 'keep' ? banner?.imageUrl ?? null : null;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setErrors((p) => ({ ...p, picture: 'Choose a picture (JPEG, PNG or WebP).' }));
    setErrors((p) => ({ ...p, picture: undefined }));
    setCropping(file);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const found: FieldErrors<'title' | 'linkUrl' | 'endsAt' | 'sortOrder' | 'picture'> = {
      title: textError(form.title, 'Title', 1, 80),
      sortOrder: intError(form.sortOrder, 'The order', 0, 100000),
    };
    const link = form.linkUrl.trim();
    if (link && !(/^\/(?!\/)\S*$/.test(link) || /^https:\/\/[^\s/]+\S*$/.test(link))) found.linkUrl = 'Use a path on this site such as /explore, or an https:// address.';
    if (form.startsAt && form.endsAt && new Date(form.endsAt) <= new Date(form.startsAt)) found.endsAt = 'The end must be after the start.';
    setErrors(found);
    if (hasErrors(found)) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        linkUrl: link || null,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
      };
      const saved = banner ? await api.patch<Banner>(`/admin/banners/${banner.id}`, body) : await api.post<Banner>('/admin/banners', body);
      if (picture.kind === 'new') {
        const data = new FormData();
        data.append('file', picture.blob, picture.blob.type === 'image/webp' ? 'banner.webp' : 'banner.jpg');
        await api.upload(`/admin/banners/${saved.id}/image`, data);
      } else if (picture.kind === 'remove' && banner?.imageUrl) {
        await api.delete(`/admin/banners/${saved.id}/image`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the banner.');
      setBusy(false);
    }
  }

  return (
    <Modal title={banner ? 'Edit banner' : 'New banner'} subtitle="Shown on the customer site's landing page while it is on and inside its dates." onClose={onClose} busy={busy}>
      <form onSubmit={save} noValidate className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-6 py-5">
        {error && <ErrorBanner message={error} />}
        <div>
          <Label htmlFor="banner-title">Title</Label>
          <Input id="banner-title" value={form.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!errors.title} className={errors.title ? invalidClass : ''} />
          <FieldError id="banner-title-error" message={errors.title} />
        </div>
        <div>
          <Label htmlFor="banner-subtitle">Short line under it (optional)</Label>
          <Input id="banner-subtitle" value={form.subtitle} onChange={(e) => set({ subtitle: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="banner-link">Where a tap goes (optional)</Label>
          <Input id="banner-link" placeholder="/explore?type=FOOTBALL_TURF  or  https://…" value={form.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} aria-invalid={!!errors.linkUrl} className={errors.linkUrl ? invalidClass : ''} />
          <FieldError id="banner-link-error" message={errors.linkUrl} />
        </div>

        <div>
          <p className="text-sm font-medium text-gray-700">Picture (optional)</p>
          <p className="mb-2 text-xs text-gray-500">Wide, about 16:5. Without one the banner is a coloured panel with the title.</p>
          <div className="flex items-center gap-4">
            <div className="flex aspect-[16/5] w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400">
              {shownPicture ? <img src={shownPicture} alt="Banner picture" className="h-full w-full object-cover" /> : 'No picture'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPick} aria-label="Choose a banner picture" />
              <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
                {shownPicture ? 'Replace picture' : 'Upload picture'}
              </Button>
              {shownPicture && (
                <button type="button" onClick={() => setPicture({ kind: 'remove' })} className="text-xs font-medium text-gray-600 hover:underline">
                  Remove
                </button>
              )}
            </div>
          </div>
          <FieldError id="banner-picture-error" message={errors.picture} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="banner-starts">Starts (optional)</Label>
            <Input id="banner-starts" type="datetime-local" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="banner-ends">Ends (optional)</Label>
            <Input id="banner-ends" type="datetime-local" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} aria-invalid={!!errors.endsAt} className={errors.endsAt ? invalidClass : ''} />
            <FieldError id="banner-ends-error" message={errors.endsAt} />
          </div>
          <div>
            <Label htmlFor="banner-order">Order (lowest first)</Label>
            <Input id="banner-order" inputMode="numeric" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} aria-invalid={!!errors.sortOrder} className={errors.sortOrder ? invalidClass : ''} />
            <FieldError id="banner-order-error" message={errors.sortOrder} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-brand-600" />
            Switched on
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {banner ? 'Save banner' : 'Add banner'}
          </Button>
        </div>
      </form>
      {cropping && (
        <PhotoCropper
          file={cropping}
          aspect={BANNER_ASPECT}
          outputWidth={1600}
          subject="banner"
          onCancel={() => setCropping(null)}
          onCropped={(blob) => {
            setCropping(null);
            setPicture({ kind: 'new', blob, preview: URL.createObjectURL(blob) });
          }}
        />
      )}
    </Modal>
  );
}

export default function BannersPage() {
  const { data: banners, error, loading, refetch, mutate } = useFetch<Banner[]>('/admin/banners');
  const [editing, setEditing] = useState<Banner | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Banner | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Switching a banner on or off, or deleting it, shows at once; if the server refuses, the banner goes back and this says why. */
  async function switchBanner(b: Banner) {
    setRowError(null);
    await optimistic(mutate, (all) => all.map((x) => (x.id === b.id ? { ...x, isActive: !b.isActive } : x)), () => api.patch(`/admin/banners/${b.id}`, { isActive: !b.isActive }), setRowError);
    refetch();
  }
  async function deleteBanner(id: string) {
    setRowError(null);
    await optimistic(mutate, (all) => all.filter((x) => x.id !== id), () => api.delete(`/admin/banners/${id}`), setRowError);
    refetch();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Banners" subtitle="Advertising on the customer site's landing page. Each one has a picture, a title, where a tap goes, and the dates it runs." />
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>New banner</Button>
      </div>
      {(error || rowError) && <ErrorBanner message={rowError ?? error!} />}

      <Card>
        {loading && <SkeletonText className="h-16 w-full" />}
        {banners && banners.length === 0 && <EmptyState message="No banners yet. Add the first one." />}
        {banners && banners.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {banners.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-4 py-3">
                <div className="flex aspect-[16/5] w-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-brand-700 text-xs text-white/80">
                  {b.imageUrl ? <img src={b.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="px-2 text-center">{b.title}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{b.title}</p>
                  {b.subtitle && <p className="truncate text-xs text-gray-500">{b.subtitle}</p>}
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {b.linkUrl ? `Goes to ${b.linkUrl}` : 'Not clickable'} · order {b.sortOrder}
                    {(b.startsAt || b.endsAt) && ` · ${shortDate(b.startsAt) ?? 'now'} to ${shortDate(b.endsAt) ?? 'no end'}`}
                  </p>
                </div>
                <Badge value={statusOf(b)} />
                <div className="flex gap-3 text-xs font-medium">
                  <button type="button" onClick={() => setEditing(b)} aria-label={`Edit banner ${b.title}`} className="text-brand-700 hover:underline">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void switchBanner(b)}
                    aria-label={`${b.isActive ? 'Switch off' : 'Switch on'} banner ${b.title}`}
                    className="text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
                  >
                    {b.isActive ? 'Switch off' : 'Switch on'}
                  </button>
                  <button type="button" onClick={() => setDeleting(b)} aria-label={`Delete banner ${b.title}`} className="text-red-600 hover:underline">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && <BannerDialog banner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refetch} />}
      {deleting && (
        <Modal title="Delete this banner?" subtitle={`"${deleting.title}" and its picture are removed for good. To pause it instead, switch it off.`} onClose={() => setDeleting(null)}>
          <div className="flex justify-end gap-2 px-6 py-5">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const id = deleting.id;
                setDeleting(null);
                await deleteBanner(id);
              }}
            >
              Delete banner
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
