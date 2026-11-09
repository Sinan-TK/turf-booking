'use client';

import { api } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { WEEKDAYS, describeTier, type CommercialTerms } from '@/lib/commercial';
import { CommercialTermsEditor } from '@/components/commercial-terms-editor';
import { ErrorBanner, PageHeader, SkeletonDetailCard } from '@/components/ui';

/** One figure of the "at a glance" strip. */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

/**
 * The platform default commercial terms. Each facility has its own terms (edit them on the facility's page); this
 * default pre-fills a newly created facility and holds the payout schedule that applies to every owner.
 */
export default function PoliciesPage() {
  const { data, error, loading, refetch } = useFetch<{ terms: CommercialTerms | null }>('/admin/commercial-terms/default');
  const t = data?.terms;
  const first = t?.commissionTiers[0];
  const lateWindow = t?.cancellationTiers.length ? [...t.cancellationTiers].sort((a, b) => a.minHoursBeforeStart - b.minHoursBeforeStart)[0] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commercial terms"
        subtitle="The platform default. Every facility keeps its own commission, cap, minimum advance and cancellation terms, edited on the facility's page; this default pre-fills a new facility and sets the weekly owner payout day."
      />
      {loading && !data && <SkeletonDetailCard fields={4} />}
      {error && <ErrorBanner message={error} />}
      {data && !data.terms && <ErrorBanner message="No platform default is configured. Run the database seed or migration." />}
      {t && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Commission" value={first ? describeTier(first) : '-'} note={t.commissionTiers.length > 1 ? `${t.commissionTiers.length} tiers by booking count` : 'on each played booking'} />
            <Stat label="Minimum advance" value={`${t.minAdvancePercent}%`} note="paid online" />
            <Stat
              label="Last-window cancel"
              value={lateWindow ? `Platform keeps ${Math.round((100 - lateWindow.refundPercent - lateWindow.ownerPercent) * 100) / 100}%` : '-'}
              note={lateWindow ? `from ${lateWindow.minHoursBeforeStart}h before the start` : undefined}
            />
            <Stat label="Owner payout" value={WEEKDAYS[t.payoutWeekday - 1] ?? '-'} note={t.payoutTimezone} />
          </div>
          <CommercialTermsEditor
            mode="platform"
            own={t}
            effective={t}
            onSave={async (terms) => {
              // The platform default is always saved whole.
              await api.put('/admin/commercial-terms/default', { ...t, ...terms });
              refetch();
            }}
          />
        </>
      )}
    </div>
  );
}
