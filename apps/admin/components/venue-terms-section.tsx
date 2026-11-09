'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { summarize, type CommercialTerms, type FacilityMonthUsage, type VenueFacilityTerms } from '@/lib/commercial';
import { CommercialTermsEditor } from '@/components/commercial-terms-editor';
import { Badge, Button, Card, ErrorBanner, SkeletonDetailCard } from '@/components/ui';

/** What each facility of a venue runs on, with an optional deal of its own for this venue. */
export function VenueTermsSection({ venueId }: { venueId: string }) {
  const { data, error, loading, refetch } = useFetch<VenueFacilityTerms[]>(`/admin/venues/${venueId}/commercial-terms`);
  const { data: usage, refetch: refetchUsage } = useFetch<FacilityMonthUsage[]>(`/admin/venues/${venueId}/commission-month`);
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
            <MonthUsage usage={usage?.find((u) => u.categoryId === f.categoryId)} />
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
                    refetchUsage();
                  }}
                  onRemove={async () => {
                    await api.delete(`/admin/venues/${venueId}/facilities/${f.categoryId}/commercial-terms`);
                    setEditing(null);
                    refetch();
                    refetchUsage();
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

const money = (value: string | number) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** This month's commission against the cap: how many bookings, how much commission, how much room is left, and when it starts over. */
function MonthUsage({ usage }: { usage?: FacilityMonthUsage }) {
  if (!usage) return null;
  const month = new Date(`${usage.month}-15T12:00:00`).toLocaleDateString('en-IN', { month: 'long' });
  const resets = new Date(usage.resetsOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const cap = usage.monthlyCommissionCap === null ? null : Number(usage.monthlyCommissionCap);
  const used = Number(usage.commission);
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-sm">
      <p className="text-gray-700">
        <span className="font-medium">{month}:</span> {usage.bookings} played booking{usage.bookings === 1 ? '' : 's'} · {money(used)} commission
        {cap !== null ? ` of ${money(cap)} cap` : ' · no monthly cap'}
        {cap !== null && usage.capUnits && usage.capUnits > 1 && usage.capPerUnit ? ` (${money(usage.capPerUnit)} × ${usage.capUnits} units)` : ''}
      </p>
      {cap !== null && (
        <div className="mt-2" role="progressbar" aria-label="Commission cap used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
            <div className={`h-full rounded-full ${usage.capReached ? 'bg-amber-500' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {usage.capReached ? 'Cap reached: only the payment fee applies for the rest of the month.' : `${money(usage.capRemaining ?? 0)} until the cap.`} Starts over on {resets}.
          </p>
        </div>
      )}
      {cap === null && <p className="mt-1 text-xs text-gray-500">The booking count for commission rates starts over on {resets}.</p>}
    </div>
  );
}
