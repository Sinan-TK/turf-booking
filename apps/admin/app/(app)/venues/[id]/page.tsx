'use client';

import { useState } from 'react';
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
  PageHeader,
  Select,
  SkeletonDetailCard,
  SkeletonText,
} from '@/components/ui';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  description: string | null;
  address: string;
  status: string;
  timezone: string;
  organizationId: string;
  defaultSlotGranularityMinutes: number;
  category: VenueCategorySummary;
}

interface Resource {
  id: string;
  name: string;
  groundType: string;
  isBookable: boolean;
  sortOrder: number;
}

const STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

export default function VenueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: venue, error, loading, mutate } = useFetch<Venue>(`/venues/${id}`);
  const { data: resources, refetch: refetchResources } = useFetch<Resource[]>(`/resources?venueId=${id}`);

  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [resourceForm, setResourceForm] = useState({ name: '', groundType: '', isBookable: true });
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceSubmitting, setResourceSubmitting] = useState(false);

  const [composition, setComposition] = useState({ parentResourceId: '', childResourceId: '' });
  const [compositionError, setCompositionError] = useState<string | null>(null);
  const [compositionSubmitting, setCompositionSubmitting] = useState(false);

  async function updateStatus(status: string) {
    if (!venue) return;
    const previous = venue.status;
    setStatusError(null);
    setPendingStatus(status);
    // Optimistic: show the new status immediately, revert only if the
    // request actually fails — the common case (success) never makes
    // the admin wait to see the change reflected.
    mutate((prev) => (prev ? { ...prev, status } : prev));
    try {
      await api.patch(`/venues/${id}`, { status });
    } catch (err) {
      mutate((prev) => (prev ? { ...prev, status: previous } : prev));
      setStatusError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setPendingStatus(null);
    }
  }

  async function onCreateResource(e: React.FormEvent) {
    e.preventDefault();
    setResourceError(null);
    setResourceSubmitting(true);
    try {
      await api.post('/resources', { venueId: id, ...resourceForm, sortOrder: resources?.length ?? 0 });
      setResourceForm({ name: '', groundType: '', isBookable: true });
      refetchResources();
    } catch (err) {
      setResourceError(err instanceof ApiError ? err.message : 'Failed to create resource');
    } finally {
      setResourceSubmitting(false);
    }
  }

  async function onCreateComposition(e: React.FormEvent) {
    e.preventDefault();
    setCompositionError(null);
    setCompositionSubmitting(true);
    try {
      await api.post('/resources/compositions', composition);
      setComposition({ parentResourceId: '', childResourceId: '' });
      refetchResources();
    } catch (err) {
      setCompositionError(err instanceof ApiError ? err.message : 'Failed to link resources');
    } finally {
      setCompositionSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonText className="mb-6 h-6 w-48" />
        <SkeletonDetailCard fields={4} />
        <Card>
          <SkeletonText className="mb-4 h-4 w-24" />
          <SkeletonText className="h-4 w-full" />
        </Card>
      </div>
    );
  }
  if (error) return <ErrorBanner message={error} />;
  if (!venue) return null;

  return (
    <div className="space-y-6">
      <PageHeader title={venue.name} />

      <Card>
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-sm text-gray-500">{venue.facilityCode}</span>
          <Badge value={venue.status} />
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Address</dt>
            <dd>{venue.address}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Venue type</dt>
            <dd>{venue.category.name}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Timezone</dt>
            <dd>{venue.timezone}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Slot Granularity</dt>
            <dd>{venue.defaultSlotGranularityMinutes} min (fixed)</dd>
          </div>
          <div>
            <dt className="text-gray-500">Description</dt>
            <dd>{venue.description || '—'}</dd>
          </div>
        </dl>

        <div className="mt-5 border-t border-gray-100 pt-4">
          <Label>Change Status</Label>
          {statusError && (
            <div className="mb-2">
              <ErrorBanner message={statusError} />
            </div>
          )}
          <div className="flex gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s}
                variant={s === venue.status ? 'primary' : 'secondary'}
                loading={pendingStatus === s}
                disabled={pendingStatus !== null || s === venue.status}
                onClick={() => updateStatus(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Resources</h2>
        {resources && resources.length > 0 ? (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Bookable</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2">{r.groundType}</td>
                    <td className="py-2">{r.isBookable ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mb-6 text-sm text-gray-500">No resources yet.</p>
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
          <Button type="submit" loading={resourceSubmitting}>
            {resourceSubmitting ? 'Adding…' : 'Add Resource'}
          </Button>
        </form>

        {resources && resources.length >= 2 && (
          <form onSubmit={onCreateComposition} className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-3">
            {compositionError && (
              <div className="col-span-3">
                <ErrorBanner message={compositionError} />
              </div>
            )}
            <div>
              <Label>Parent (contains the child)</Label>
              <Select
                required
                value={composition.parentResourceId}
                onChange={(e) => setComposition((c) => ({ ...c, parentResourceId: e.target.value }))}
              >
                <option value="">Select…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Child (part of the parent)</Label>
              <Select
                required
                value={composition.childResourceId}
                onChange={(e) => setComposition((c) => ({ ...c, childResourceId: e.target.value }))}
              >
                <option value="">Select…</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={compositionSubmitting}>
              {compositionSubmitting ? 'Linking…' : 'Link as Composition'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
