'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import type { VenueCategorySummary } from '@/lib/categories';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
} from '@/components/ui';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  description: string | null;
  address: string;
  status: string;
  timezone: string;
  defaultSlotGranularityMinutes: number;
  category: VenueCategorySummary;
}

interface Resource {
  id: string;
  name: string;
  groundType: string;
  isBookable: boolean;
}

// Going live (ACTIVE) or being suspended (SUSPENDED) are platform
// moderation actions reserved for Super Admin — see
// VenuesService.OWNER_ALLOWED_STATUSES. Only DRAFT/INACTIVE are offered
// here; the backend would reject anything else from a VENUE_OWNER anyway,
// this just avoids showing a control that would always 403.
const OWNER_STATUSES = ['DRAFT', 'INACTIVE'];

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, refetch } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources } = useFetch<Resource[]>(`/resources?venueId=${id}`);

  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [resourceForm, setResourceForm] = useState({ name: '', groundType: '' });
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceSubmitting, setResourceSubmitting] = useState(false);

  async function updateStatus(status: string) {
    setStatusError(null);
    setStatusSaving(true);
    try {
      await api.patch(`/venues/${id}`, { status });
      refetch();
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setStatusSaving(false);
    }
  }

  async function onCreateResource(e: React.FormEvent) {
    e.preventDefault();
    setResourceError(null);
    setResourceSubmitting(true);
    try {
      await api.post('/resources', {
        venueId: id,
        ...resourceForm,
        isBookable: true,
        sortOrder: resources?.length ?? 0,
      });
      setResourceForm({ name: '', groundType: '' });
      refetchResources();
    } catch (err) {
      setResourceError(err instanceof ApiError ? err.message : 'Failed to create resource');
    } finally {
      setResourceSubmitting(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorBanner message={error} />;
  if (!venue) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={venue.name}
        action={
          <Link href={`/venues/${id}/availability`}>
            <Button variant="secondary">Manage Availability & Pricing →</Button>
          </Link>
        }
      />

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-sm text-on-surface-variant">{venue.facilityCode}</span>
          <Badge value={venue.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-on-surface-variant">Address</dt>
            <dd>{venue.address}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Venue type</dt>
            <dd>{venue.category.name}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Timezone</dt>
            <dd>{venue.timezone}</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Slot Granularity</dt>
            <dd>{venue.defaultSlotGranularityMinutes} min (fixed)</dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Description</dt>
            <dd>{venue.description || '—'}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-outline-variant/20 pt-4">
          <Label>Change Status</Label>
          <p className="mb-2 text-xs text-on-surface-variant">
            Going live or being suspended is a platform review step — contact the platform to activate
            a DRAFT venue.
          </p>
          {statusError && (
            <div className="mb-2">
              <ErrorBanner message={statusError} />
            </div>
          )}
          <div className="flex gap-2">
            {OWNER_STATUSES.map((s) => (
              <Button
                key={s}
                variant={s === venue.status ? 'primary' : 'secondary'}
                disabled={statusSaving || s === venue.status}
                onClick={() => updateStatus(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-on-surface">Resources</h2>
        {resources && resources.length > 0 ? (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-outline-variant/30 text-xs uppercase text-on-surface-variant">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Bookable</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2">{r.groundType}</td>
                    <td className="py-2">{r.isBookable ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mb-6 text-sm text-on-surface-variant">No resources yet.</p>
        )}

        <form onSubmit={onCreateResource} className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {resourceError && (
            <div className="col-span-3">
              <ErrorBanner message={resourceError} />
            </div>
          )}
          <div>
            <Label>{venue.category.unitLabel} Name</Label>
            <Input
              required
              placeholder={`e.g. ${venue.category.unitLabel} 1`}
              value={resourceForm.name}
              onChange={(e) => setResourceForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <Label>{venue.category.unitLabel} type</Label>
            {venue.category.unitTypes.length > 0 ? (
              <Select
                required
                value={resourceForm.groundType}
                onChange={(e) => setResourceForm((f) => ({ ...f, groundType: e.target.value }))}
              >
                <option value="">Select type…</option>
                {venue.category.unitTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                required
                maxLength={20}
                placeholder="e.g. Standard"
                value={resourceForm.groundType}
                onChange={(e) => setResourceForm((f) => ({ ...f, groundType: e.target.value }))}
              />
            )}
          </div>
          <Button type="submit" disabled={resourceSubmitting}>
            {resourceSubmitting ? 'Adding…' : 'Add Resource'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
