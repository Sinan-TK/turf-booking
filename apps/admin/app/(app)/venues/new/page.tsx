'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Button, Card, ErrorBanner, FieldError, Input, Label, LoadingState, PageHeader, Select, invalidClass } from '@/components/ui';
import { hasErrors, numberError, textError, type FieldErrors } from '@/lib/validation';
import { googleMapsUrlProblem } from '@venue/shared/dist/maps-url';

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
interface Organization {
  id: string;
  name: string;
}

export default function NewVenuePage() {
  const router = useRouter();
  const { data: states } = useFetch<State[]>('/states');
  const [stateId, setStateId] = useState('');
  const { data: districts } = useFetch<District[]>(stateId ? `/districts?stateId=${stateId}` : null);
  const { data: organizations } = useFetch<Organization[]>('/admin/organizations');

  const [form, setForm] = useState({
    name: '',
    description: '',
    districtId: '',
    address: '',
    lat: '',
    lng: '',
    googleMapsUrl: '',
    organizationId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((p) => (p[key] ? { ...p, [key]: undefined } : p));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found: FieldErrors<keyof typeof form> = {
      organizationId: form.organizationId ? undefined : 'Select the owner organization.',
      name: textError(form.name, 'Venue name', 1, 150),
      description: form.description.length > 2000 ? 'Description can be at most 2000 characters.' : undefined,
      districtId: form.districtId ? undefined : stateId ? 'Select a district.' : 'Select a state, then a district.',
      address: textError(form.address, 'Address', 1, 300),
      lat: numberError(form.lat, 'Latitude', -90, 90),
      lng: numberError(form.lng, 'Longitude', -180, 180),
      googleMapsUrl: googleMapsUrlProblem(form.googleMapsUrl),
    };
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['organizationId', 'name', 'description', 'districtId', 'address', 'lat', 'lng', 'googleMapsUrl'] as const).find((k) => found[k]);
      document.getElementById('venue-' + first)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const venue = await api.post<{ id: string }>('/venues', {
        name: form.name,
        description: form.description || undefined,
        districtId: form.districtId,
        address: form.address,
        lat: Number(form.lat),
        lng: Number(form.lng),
        googleMapsUrl: form.googleMapsUrl.trim() || undefined,
        organizationId: form.organizationId,
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
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <ErrorBanner message={error} />}

          <div>
            <Label htmlFor="venue-organizationId">Owner Organization</Label>
            <Select id="venue-organizationId" aria-invalid={!!errors.organizationId}
 className={errors.organizationId ? invalidClass : ''} value={form.organizationId} onChange={(e) => update('organizationId', e.target.value)}>
              <option value="">Select organization…</option>
              {organizations?.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
            <FieldError id="venue-organizationId-error" message={errors.organizationId} />
          </div>

          <div>
            <Label htmlFor="venue-name">Name</Label>
            <Input id="venue-name" aria-invalid={!!errors.name}
 className={errors.name ? invalidClass : ''} value={form.name} onChange={(e) => update('name', e.target.value)} />
            <FieldError id="venue-name-error" message={errors.name} />
          </div>

          <div>
            <Label htmlFor="venue-description">Description</Label>
            <Input id="venue-description" aria-invalid={!!errors.description}
 className={errors.description ? invalidClass : ''} value={form.description} onChange={(e) => update('description', e.target.value)} />
            <FieldError id="venue-description-error" message={errors.description} />
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
              <Label htmlFor="venue-districtId">District</Label>
              <Select
                id="venue-districtId"
                aria-invalid={!!errors.districtId}
 className={errors.districtId ? invalidClass : ''}
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
              <FieldError id="venue-districtId-error" message={errors.districtId} />
            </div>
          </div>

          <div>
            <Label htmlFor="venue-address">Address</Label>
            <Input id="venue-address" aria-invalid={!!errors.address}
 className={errors.address ? invalidClass : ''} value={form.address} onChange={(e) => update('address', e.target.value)} />
            <FieldError id="venue-address-error" message={errors.address} />
          </div>

          <div>
            <Label>Location</Label>
            <MapLocationPicker
              lat={form.lat}
              lng={form.lng}
              onChange={(lat, lng) => {
                setForm((f) => ({ ...f, lat, lng }));
                setErrors((p) => ({ ...p, lat: undefined, lng: undefined }));
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="venue-lat">Latitude</Label>
              <Input
                id="venue-lat"
                aria-invalid={!!errors.lat}
 className={errors.lat ? invalidClass : ''}
                type="number"
                step="any"
                value={form.lat}
                onChange={(e) => update('lat', e.target.value)}
              />
              <FieldError id="venue-lat-error" message={errors.lat} />
            </div>
            <div>
              <Label htmlFor="venue-lng">Longitude</Label>
              <Input
                id="venue-lng"
                aria-invalid={!!errors.lng}
 className={errors.lng ? invalidClass : ''}
                type="number"
                step="any"
                value={form.lng}
                onChange={(e) => update('lng', e.target.value)}
              />
              <FieldError id="venue-lng-error" message={errors.lng} />
            </div>
          </div>
            <div className="mt-4">
              <Label htmlFor="venue-googleMapsUrl">Google Maps link (optional)</Label>
              <Input
                id="venue-googleMapsUrl"
                type="url"
                inputMode="url"
                aria-invalid={!!errors.googleMapsUrl}
                className={errors.googleMapsUrl ? invalidClass : ''}
                placeholder="https://maps.app.goo.gl/…"
                value={form.googleMapsUrl}
                onChange={(e) => update('googleMapsUrl', e.target.value)}
              />
              <FieldError id="venue-googleMapsUrl-error" message={errors.googleMapsUrl} />
              <p className="mt-1 text-xs text-gray-500">Open the place in Google Maps, choose Share, then Copy link. Customers' Directions button opens it; leave it empty to use the map pin.</p>
            </div>

          <p className="text-xs text-gray-500">
            Add the facilities (football turf, swimming pool…) and their units from the venue page after creating it.
            The timezone follows the venue&apos;s district.
          </p>

          <Button type="submit" loading={submitting}>
            {submitting ? 'Creating…' : 'Create Venue'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
