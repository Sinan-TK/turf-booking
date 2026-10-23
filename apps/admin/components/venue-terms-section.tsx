'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { summarize, type CommercialTerms, type VenueFacilityTerms } from '@/lib/commercial';
import { CommercialTermsEditor } from '@/components/commercial-terms-editor';
import { Badge, Button, Card, ErrorBanner, SkeletonDetailCard } from '@/components/ui';

/** What each facility of a venue runs on, with an optional deal of its own for this venue. */
export function VenueTermsSection({ venueId }: { venueId: string }) {
  const { data, error, loading, refetch } = useFetch<VenueFacilityTerms[]>(`/admin/venues/${venueId}/commercial-terms`);
  const [editing, setEditing] = useState<string | null>(null);

  if (loading && !data) return <SkeletonDetailCard fields={3} />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Commission &amp; cancellation</h2>
      <p className="mb-4 text-xs text-gray-500">
        Each facility follows its own terms (edit them on the facility's page). A venue can have a deal of its own: switch on only the values that
        differ and everything else keeps following the facility.
      </p>
      {data.length === 0 && <p className="text-sm text-gray-500">Add a unit to see the terms that apply.</p>}
      <div className="space-y-4">
        {data.map((f) => (
          <div key={f.categoryId} className="rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-900">
                {f.name} {f.own && <Badge value="CUSTOM DEAL" />}
              </h3>
              <Button type="button" variant="secondary" onClick={() => setEditing(editing === f.categoryId ? null : f.categoryId)}>
                {editing === f.categoryId ? 'Close' : f.own ? 'Edit this venue\'s deal' : 'Set a custom deal'}
              </Button>
            </div>
            <p className="mt-1 text-sm text-gray-600">{summarize(f.terms)}</p>
            {editing === f.categoryId && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <CommercialTermsEditor
                  mode="override"
                  own={f.own}
                  effective={f.terms}
                  sources={f.sources}
                  onSave={async (terms: Partial<CommercialTerms>) => {
                    await api.put(`/admin/venues/${venueId}/facilities/${f.categoryId}/commercial-terms`, terms);
                    refetch();
                  }}
                  onRemove={async () => {
                    await api.delete(`/admin/venues/${venueId}/facilities/${f.categoryId}/commercial-terms`);
                    setEditing(null);
                    refetch();
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
