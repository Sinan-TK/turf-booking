'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import type { VenueCategory } from '@/lib/categories';
import { Button, Card, ErrorBanner, Input, Label, LoadingState, PageHeader, Select } from '@/components/ui';

// Leaflet touches `window` at import time, which breaks server-side
// rendering — this page is SSR'd by default under the App Router, so
// the map must be loaded client-only.
const MapLocationPicker = dynamic(() => import('@/components/map-location-picker'), {
  ssr: false,
  loading: () => <LoadingState />,
});

interface State {
  id: string;
  name: string;
}
interface District {
  id: string;
  name: string;
  code: string;
}

export default function NewVenuePage() {
  const router = useRouter();
  const { data: states } = useFetch<State[]>('/states');
  const [stateId, setStateId] = useState('');
  const { data: districts } = useFetch<District[]>(stateId ? `/districts?stateId=${stateId}` : null);
  const { data: categories } = useFetch<VenueCategory[]>('/categories');

  const [form, setForm] = useState({
    name: '',
    description: '',
    districtId: '',
    address: '',
    lat: '',
    lng: '',
    timezone: 'Asia/Kolkata',
    categoryId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // organizationId is deliberately omitted — the API always derives it
      // from the logged-in owner's own session for a VENUE_OWNER caller
      // (venues.service.ts), never trusting a client-supplied value.
      const venue = await api.post<{ id: string }>('/venues', {
        name: form.name,
        description: form.description || undefined,
        districtId: form.districtId,
        address: form.address,
        lat: Number(form.lat),
        lng: Number(form.lng),
        timezone: form.timezone,
        categoryId: form.categoryId || categories?.[0]?.id,
      });
      router.push(`/venues/${venue.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create venue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="New Venue" />
      <Card className="max-w-2xl">
        <p className="mb-4 text-xs text-on-surface-variant">
          New venues start in DRAFT and become bookable once the platform activates them.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <ErrorBanner message={error} />}

          <div>
            <Label>Venue type</Label>
            <Select
              required
              value={form.categoryId || categories?.[0]?.id || ''}
              onChange={(e) => update('categoryId', e.target.value)}
            >
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-on-surface-variant">
              Decides the slot length and durations customers can book. It can't be changed after you add{' '}
              {categories?.find((c) => c.id === (form.categoryId || categories?.[0]?.id))?.unitLabel.toLowerCase() ??
                'resources'}
              s.
            </p>
          </div>

          <div>
            <Label>Name</Label>
            <Input required value={form.name} onChange={(e) => update('name', e.target.value)} />
          </div>

          <div>
            <Label>Description</Label>
            <Input value={form.description} onChange={(e) => update('description', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>State</Label>
              <Select value={stateId} onChange={(e) => setStateId(e.target.value)}>
                <option value="">Select state…</option>
                {states?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>District</Label>
              <Select
                required
                disabled={!stateId}
                value={form.districtId}
                onChange={(e) => update('districtId', e.target.value)}
              >
                <option value="">Select district…</option>
                {districts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>Address</Label>
            <Input required value={form.address} onChange={(e) => update('address', e.target.value)} />
          </div>

          <div>
            <Label>Location</Label>
            <MapLocationPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Latitude</Label>
              <Input
                required
                type="number"
                step="any"
                value={form.lat}
                onChange={(e) => update('lat', e.target.value)}
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                required
                type="number"
                step="any"
                value={form.lng}
                onChange={(e) => update('lng', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Timezone</Label>
            <Input required value={form.timezone} onChange={(e) => update('timezone', e.target.value)} />
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Venue'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
