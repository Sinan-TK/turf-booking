'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { Button, ErrorBanner, FieldError, Input, Label, PageHeader, Select, invalidClass } from '@/components/ui';
import { hasErrors, numberError, textError, type FieldErrors } from '@/lib/validation';
import { googleMapsUrlProblem } from '@venue/shared/dist/maps-url';

// Leaflet touches `window` at import time, which breaks server-side
// rendering — this page is SSR'd by default under the App Router, so
// the map must be loaded client-only.
const MapLocationPicker = dynamic(() => import('@/components/map-location-picker'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center rounded-xl bg-surface-container text-body-md text-on-surface-variant sm:h-[420px] xl:h-[460px]">
      Loading map…
    </div>
  ),
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
  const { data: districts } = useFetch<District[]>(
    stateId ? `/districts?stateId=${stateId}` : null,
  );

  const [form, setForm] = useState({
    name: '',
    description: '',
    districtId: '',
    address: '',
    lat: '',
    lng: '',
    googleMapsUrl: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors<keyof typeof form>>({});
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((p) => (p[key] ? { ...p, [key]: undefined } : p));
  }

  function validate(): FieldErrors<keyof typeof form> {
    return {
      name: textError(form.name, 'Venue name', 1, 150),
      description: form.description.length > 2000 ? 'Description can be at most 2000 characters.' : undefined,
      districtId: form.districtId ? undefined : stateId ? 'Select a district.' : 'Select a state, then a district.',
      address: textError(form.address, 'Street address', 1, 300),
      lat: numberError(form.lat, 'Latitude', -90, 90),
      lng: numberError(form.lng, 'Longitude', -180, 180),
      googleMapsUrl: googleMapsUrlProblem(form.googleMapsUrl),
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const found = validate();
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['name', 'description', 'districtId', 'address', 'lat', 'lng', 'googleMapsUrl'] as const).find((k) => found[k]);
      document.getElementById('venue-' + first)?.focus();
      return;
    }
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
        googleMapsUrl: form.googleMapsUrl.trim() || undefined,
      });
      router.push(`/venues/${venue.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create venue');
    } finally {
      setSubmitting(false);
    }
  }

  const hasPin =
    form.lat !== '' &&
    form.lng !== '' &&
    !Number.isNaN(Number(form.lat)) &&
    !Number.isNaN(Number(form.lng));
  const checklist = [
    { label: 'Name', done: form.name.trim() !== '' },
    { label: 'District', done: form.districtId !== '' },
    { label: 'Address', done: form.address.trim() !== '' },
    { label: 'Map pin', done: hasPin },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="pb-24">
      <PageHeader
        back={{ href: '/venues', label: 'All venues' }}
        title="New Venue"
        subtitle="Tell us where it is. You add its facilities and units on the next screen."
      />
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="mb-6">
            <ErrorBanner message={error} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-5">
            <Section step={1} title="Venue details" hint="What customers will see first.">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="venue-name">Name</Label>
                  <Input
                    id="venue-name"
                    aria-invalid={!!errors.name}
                    className={errors.name ? invalidClass : ''}
                    placeholder="e.g. Greenfield Sports Arena"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                  />
                  <FieldError id="venue-name-error" message={errors.name} />
                </div>
                <div>
                  <Label htmlFor="venue-description">Description</Label>
                  <Input
                    id="venue-description"
                    aria-invalid={!!errors.description}
                    className={errors.description ? invalidClass : ''}
                    placeholder="A short line about the place (optional)"
                    value={form.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                  <FieldError id="venue-description-error" message={errors.description} />
                </div>
              </div>
            </Section>

            <Section step={2} title="Address" hint="The district also sets the timezone.">
              <div className="space-y-4">
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
                  <Label htmlFor="venue-address">Street address</Label>
                  <Input
                    id="venue-address"
                    aria-invalid={!!errors.address}
                    className={errors.address ? invalidClass : ''}
                    placeholder="Building, street, area"
                    value={form.address}
                    onChange={(e) => update('address', e.target.value)}
                  />
                  <FieldError id="venue-address-error" message={errors.address} />
                </div>
              </div>
            </Section>
          </div>

          <div className="xl:col-span-7">
            <Section
              step={3}
              title="Pin the location"
              hint="Drag the marker to fine-tune. Customers navigate to this point."
            >
              <MapLocationPicker
                lat={form.lat}
                lng={form.lng}
                onChange={(lat, lng) => {
                  setForm((f) => ({ ...f, lat, lng }));
                  setErrors((p) => ({ ...p, lat: undefined, lng: undefined }));
                }}
              />
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="venue-lat">Latitude</Label>
                  <Input
                    id="venue-lat"
                    aria-invalid={!!errors.lat}
                    className={errors.lat ? invalidClass : ''}
                    type="number"
                    step="any"
                    placeholder="10.850500"
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
                    placeholder="76.271100"
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
            </Section>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-outline-variant/30 bg-surface/90 backdrop-blur-xl md:left-[72px]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-container-padding py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium text-on-surface-variant">
                {doneCount} of {checklist.length} done
              </span>
              {checklist.map((c) => (
                <span
                  key={c.label}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    c.done
                      ? 'bg-primary-fixed-dim/25 text-on-primary-container'
                      : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  <span aria-hidden="true">{c.done ? '✓' : '○'}</span>
                  {c.label}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-on-surface-variant lg:inline">
                Starts as DRAFT until the platform activates it.
              </span>
              <Link href="/venues">
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Venue'}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/** A numbered form section: a tinted header strip over the fields. */
function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
      <header className="flex items-center gap-3 border-b border-outline-variant/20 bg-surface-container-low px-container-padding py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary">
          {step}
        </span>
        <div>
          <h2 className="text-body-md font-semibold text-on-surface">{title}</h2>
          <p className="text-xs text-on-surface-variant">{hint}</p>
        </div>
      </header>
      <div className="p-container-padding">{children}</div>
    </section>
  );
}
